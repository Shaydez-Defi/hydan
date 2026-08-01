// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import { IERC20 } from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import { SafeERC20 } from '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import { Nox, euint256, ebool, externalEuint256 } from '@iexec-nox/nox-protocol-contracts/contracts/sdk/Nox.sol';

interface IPoolAddressesProvider {
  function getPool() external view returns (address);
  function getPriceOracle() external view returns (address);
}

interface IPool {
  function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;
  function withdraw(address asset, uint256 amount, address to) external returns (uint256);
  function borrow(
    address asset,
    uint256 amount,
    uint256 interestRateMode,
    uint16 referralCode,
    address onBehalfOf
  ) external;
  function repay(
    address asset,
    uint256 amount,
    uint256 interestRateMode,
    address onBehalfOf
  ) external returns (uint256);
  function getUserAccountData(
    address user
  )
    external
    view
    returns (
      uint256 totalCollateralBase,
      uint256 totalDebtBase,
      uint256 availableBorrowsBase,
      uint256 currentLiquidationThreshold,
      uint256 ltv,
      uint256 healthFactor
    );
}

interface IProtocolDataProvider {
  function getReserveTokensAddresses(
    address asset
  ) external view returns (address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress);
}

interface IPriceOracleGetter {
  function getAssetPrice(address asset) external view returns (uint256);
}

contract HydanVault {
  using SafeERC20 for IERC20;
  using Nox for euint256;
  using Nox for ebool;

  event VaultInitialized(address indexed asset, address indexed aavePool);
  event Deposited(address indexed user, euint256 balance);
  event Withdrawn(address indexed user, euint256 assets);
  event Borrowed(address indexed user, euint256 amount, uint256 interestRateMode);
  event Repaid(address indexed user, euint256 assets);
  event WithdrawPrepared(address indexed user, ebool approval);
  event BooksPrepared(address indexed user, ebool booksOk);
  event HealthStatusUpdated(address indexed vault, ebool isHealthy);

  address public immutable asset;
  address public aavePool;
  address public immutable aavePoolAddressesProvider;
  address public immutable debtAsset;
  address public immutable priceOracle;
  address public aToken;

  // Confidential per-user positions. Handles are unique and only the user
  // (added as viewer) can decrypt them; they are never publicly decryptable.
  mapping(address => euint256) public balanceOf;
  mapping(address => euint256) public debtOf;
  mapping(address => ebool) public withdrawApproval;
  mapping(address => ebool) public booksInvariant;

  // Sum of all confidential balances, checked against totalDeposited at
  // withdraw time so overstated declarations cannot be cashed out.
  euint256 public aggregateBalance;
  uint256 public totalDeposited;

  ebool public healthStatus;

  constructor(address _asset, address _aavePoolAddressesProvider, address _debtAsset) {
    asset = _asset;
    aavePoolAddressesProvider = _aavePoolAddressesProvider;
    debtAsset = _debtAsset;
    priceOracle = IPoolAddressesProvider(_aavePoolAddressesProvider).getPriceOracle();
    emit VaultInitialized(asset, address(0));
  }

  function setAavePool(address _aavePool) external {
    require(aavePool == address(0), 'aavePool already set');
    aavePool = _aavePool;
  }

  function setAToken(address _aToken) external {
    require(aToken == address(0), 'aToken already set');
    aToken = _aToken;
  }

  function totalAssets() public view returns (uint256) {
    return IERC20(aToken).balanceOf(address(this));
  }

  function maxWithdrawable() public view returns (uint256) {
    (uint256 collateralBase, uint256 debtBase, , uint256 liquidationThreshold, , ) = IPool(aavePool).getUserAccountData(
      address(this)
    );
    if (debtBase == 0) return totalAssets();
    uint256 minCollateralBase = (debtBase * 10000 + liquidationThreshold - 1) / liquidationThreshold;
    if (collateralBase <= minCollateralBase) return 0;
    uint256 price = IPriceOracleGetter(priceOracle).getAssetPrice(asset);
    return ((collateralBase - minCollateralBase) * 1e18) / price;
  }

  function deposit(
    uint256 assets,
    address receiver,
    externalEuint256 encryptedAssets,
    bytes calldata inputProof
  ) external returns (euint256) {
    require(assets > 0, 'Amount must be > 0');
    euint256 amount = Nox.fromExternal(encryptedAssets, inputProof);
    amount.allow(address(this));
    amount.allow(receiver);

    IERC20(asset).safeTransferFrom(msg.sender, address(this), assets);
    IERC20(asset).forceApprove(aavePool, assets);
    IPool(aavePool).supply(asset, assets, address(this), 0);

    if (euint256.unwrap(balanceOf[receiver]) == bytes32(0)) {
      balanceOf[receiver] = amount;
    } else {
      balanceOf[receiver] = balanceOf[receiver].add(amount);
    }
    aggregateBalance = aggregateBalance.add(amount);
    totalDeposited += assets;

    balanceOf[receiver].allow(address(this));
    balanceOf[receiver].allow(receiver);
    Nox.addViewer(balanceOf[receiver], receiver);
    aggregateBalance.allow(address(this));

    emit Deposited(receiver, balanceOf[receiver]);
    return balanceOf[receiver];
  }

  function prepareWithdraw(uint256 assets, address onBehalfOf) external {
    require(msg.sender == onBehalfOf, 'Only the position owner can prepare a withdrawal');
    require(assets > 0, 'Amount must be > 0');
    ebool canWithdraw = balanceOf[onBehalfOf].ge(Nox.toEuint256(assets));
    ebool booksOk = aggregateBalance.eq(Nox.toEuint256(totalDeposited));
    withdrawApproval[onBehalfOf] = canWithdraw;
    booksInvariant[onBehalfOf] = booksOk;
    Nox.allowPublicDecryption(canWithdraw);
    Nox.allowPublicDecryption(booksOk);
    emit WithdrawPrepared(onBehalfOf, canWithdraw);
    emit BooksPrepared(onBehalfOf, booksOk);
  }

  function withdraw(
    bytes calldata approvalProof,
    bytes calldata invariantProof,
    uint256 assets,
    address receiver,
    address owner
  ) external {
    require(msg.sender == owner, 'Only the position owner can withdraw');
    bool approved = Nox.publicDecrypt(withdrawApproval[owner], approvalProof);
    require(approved, 'Withdraw not approved');
    bool booksOk = Nox.publicDecrypt(booksInvariant[owner], invariantProof);
    require(booksOk, 'Confidential books are inconsistent');
    withdrawApproval[owner] = ebool.wrap(bytes32(0));
    booksInvariant[owner] = ebool.wrap(bytes32(0));

    uint256 maxAssets = maxWithdrawable();
    if (assets > maxAssets) assets = maxAssets;

    euint256 assetsEncrypted = Nox.toEuint256(assets);
    balanceOf[owner] = balanceOf[owner].sub(assetsEncrypted);
    aggregateBalance = aggregateBalance.sub(assetsEncrypted);
    totalDeposited -= assets;

    uint256 withdrawn = IPool(aavePool).withdraw(asset, assets, address(this));
    IERC20(asset).safeTransfer(receiver, withdrawn);

    balanceOf[owner].allow(owner);
    balanceOf[owner].allow(address(this));
    Nox.addViewer(balanceOf[owner], owner);
    aggregateBalance.allow(address(this));

    emit Withdrawn(owner, assetsEncrypted);
  }

  function updateHealthStatus(
    externalEuint256 encryptedHealthFactor,
    bytes calldata inputProof,
    uint256 threshold
  ) external {
    euint256 healthFactor = Nox.fromExternal(encryptedHealthFactor, inputProof);
    euint256 thresholdEncrypted = Nox.toEuint256(threshold);
    ebool isHealthy = healthFactor.gt(thresholdEncrypted);
    healthStatus = isHealthy;
    Nox.allowPublicDecryption(isHealthy);
    emit HealthStatusUpdated(address(this), isHealthy);
  }

  function prepareBorrow(
    externalEuint256 encryptedAmount,
    externalEuint256 encryptedStorage,
    bytes calldata amountInputProof,
    bytes calldata storageInputProof
  ) external {
    euint256 amount = Nox.fromExternal(encryptedAmount, amountInputProof);
    euint256 storageHandle = Nox.fromExternal(encryptedStorage, storageInputProof);
    amount.allow(address(this));
    amount.allow(msg.sender);
    storageHandle.allow(address(this));
    storageHandle.allow(msg.sender);
    Nox.allowPublicDecryption(amount);
  }

  function borrow(
    address _asset,
    externalEuint256 encryptedAmount,
    externalEuint256 encryptedStorage,
    bytes calldata storageInputProof,
    bytes calldata decryptionProof,
    uint256 interestRateMode,
    uint16 referralCode,
    address onBehalfOf
  ) external {
    euint256 amount = euint256.wrap(externalEuint256.unwrap(encryptedAmount));
    uint256 assets = Nox.publicDecrypt(amount, decryptionProof);
    require(assets > 0, 'Amount must be > 0');

    euint256 storageHandle = Nox.fromExternal(encryptedStorage, storageInputProof);
    storageHandle.allow(address(this));
    storageHandle.allow(onBehalfOf);

    if (euint256.unwrap(debtOf[onBehalfOf]) == bytes32(0)) {
      debtOf[onBehalfOf] = storageHandle;
    } else {
      debtOf[onBehalfOf] = debtOf[onBehalfOf].add(storageHandle);
    }
    debtOf[onBehalfOf].allow(onBehalfOf);
    debtOf[onBehalfOf].allow(address(this));
    Nox.addViewer(debtOf[onBehalfOf], onBehalfOf);

    IPool(aavePool).borrow(_asset, assets, interestRateMode, referralCode, address(this));
    IERC20(_asset).safeTransfer(onBehalfOf, assets);
    emit Borrowed(onBehalfOf, debtOf[onBehalfOf], interestRateMode);
  }

  function repay(address _asset, uint256 assets, uint256 interestRateMode, address onBehalfOf) external {
    require(assets > 0, 'Amount must be > 0');

    IERC20(_asset).safeTransferFrom(onBehalfOf, address(this), assets);
    IERC20(_asset).forceApprove(aavePool, assets);
    IPool(aavePool).repay(_asset, assets, interestRateMode, address(this));

    euint256 assetsEncrypted = Nox.toEuint256(assets);
    debtOf[onBehalfOf] = debtOf[onBehalfOf].sub(assetsEncrypted);
    debtOf[onBehalfOf].allow(onBehalfOf);
    debtOf[onBehalfOf].allow(address(this));
    Nox.addViewer(debtOf[onBehalfOf], onBehalfOf);

    emit Repaid(onBehalfOf, assetsEncrypted);
  }
}
