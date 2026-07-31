// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Nox, euint256, ebool, externalEuint256 } from "@iexec-nox/nox-protocol-contracts/contracts/sdk/Nox.sol";

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
    function repay(address asset, uint256 amount, uint256 interestRateMode, address onBehalfOf) external returns (uint256);
    function getUserAccountData(address user) external view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor);
}

interface IProtocolDataProvider {
    function getReserveTokensAddresses(
        address asset
    ) external view returns (address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress);
}

interface IPriceOracleGetter {
    function getAssetPrice(address asset) external view returns (uint256);
}

interface IERC20Decimals {
    function decimals() external view returns (uint8);
}

contract HydanVault {
    using SafeERC20 for IERC20;
    using Nox for euint256;
    using Nox for ebool;

    event VaultInitialized(address indexed asset, address indexed aavePool);
    event Deposited(address indexed user, euint256 shares);
    event Withdrawn(address indexed user, euint256 shares);
    event Borrowed(address indexed user, euint256 amount, uint256 interestRateMode);
    event Repaid(address indexed user, euint256 assets);
    event WithdrawPrepared(address indexed user, ebool approval);
    event HealthStatusUpdated(address indexed vault, ebool isHealthy);

    address public immutable asset;
    address public aavePool;
    address public immutable aavePoolAddressesProvider;
    address public immutable debtAsset;
    address public immutable priceOracle;
    address public aToken;

    uint256 public totalShares;

    mapping(address => euint256) public balanceOf;
    mapping(address => euint256) public debtOf;
    mapping(address => ebool) public withdrawApproval;

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
        (uint256 collateralBase, uint256 debtBase, , uint256 liquidationThreshold, , ) =
            IPool(aavePool).getUserAccountData(address(this));
        if (debtBase == 0) return totalAssets();
        uint256 minCollateralBase = (debtBase * 10000 + liquidationThreshold - 1) / liquidationThreshold;
        if (collateralBase <= minCollateralBase) return 0;
        uint256 price = IPriceOracleGetter(priceOracle).getAssetPrice(asset);
        return ((collateralBase - minCollateralBase) * 1e18) / price;
    }

    function previewDeposit(uint256 assets) public view returns (uint256) {
        if (totalShares == 0) return assets;
        return (assets * totalShares) / totalAssets();
    }

    function previewWithdraw(uint256 assets) public view returns (uint256) {
        if (totalShares == 0) return assets;
        return (assets * totalShares) / totalAssets();
    }

    function deposit(uint256 assets, address receiver) external returns (euint256 shares) {
        require(assets > 0, 'Amount must be > 0');

        uint256 sharesPlain = previewDeposit(assets);
        require(sharesPlain > 0, 'Zero shares');

        shares = Nox.toEuint256(sharesPlain);

        IERC20(asset).safeTransferFrom(msg.sender, address(this), assets);
        IERC20(asset).forceApprove(aavePool, assets);
        IPool(aavePool).supply(asset, assets, address(this), 0);

        if (euint256.unwrap(balanceOf[receiver]) == bytes32(0)) {
            balanceOf[receiver] = shares;
        } else {
            balanceOf[receiver] = balanceOf[receiver].add(shares);
        }
        totalShares += sharesPlain;

        balanceOf[receiver].allow(receiver);
        balanceOf[receiver].allow(address(this));

        emit Deposited(receiver, shares);
    }

    function prepareWithdraw(
        uint256 assets,
        address onBehalfOf
    ) external {
        uint256 shares = previewWithdraw(assets);
        require(shares > 0, 'Zero shares');
        euint256 sharesEncrypted = Nox.toEuint256(shares);
        ebool canWithdraw = balanceOf[onBehalfOf].ge(sharesEncrypted);
        withdrawApproval[onBehalfOf] = canWithdraw;
        Nox.allowPublicDecryption(canWithdraw);
        emit WithdrawPrepared(onBehalfOf, canWithdraw);
    }

    function withdraw(
        bytes calldata approvalProof,
        uint256 assets,
        address receiver,
        address owner
    ) external {
        bool approved = Nox.publicDecrypt(withdrawApproval[owner], approvalProof);
        require(approved, 'Withdraw not approved');
        withdrawApproval[owner] = ebool.wrap(bytes32(0));

        uint256 maxAssets = maxWithdrawable();
        if (assets > maxAssets) assets = maxAssets;

        uint256 shares = previewWithdraw(assets);
        require(shares > 0, 'Zero shares');

        euint256 sharesEncrypted = Nox.toEuint256(shares);
        balanceOf[owner] = balanceOf[owner].sub(sharesEncrypted);
        totalShares -= shares;

        uint256 withdrawn = IPool(aavePool).withdraw(asset, assets, address(this));
        IERC20(asset).safeTransfer(receiver, withdrawn);

        balanceOf[owner].allow(owner);
        balanceOf[owner].allow(address(this));

        emit Withdrawn(owner, sharesEncrypted);
    }

    function updateHealthStatus(externalEuint256 encryptedHealthFactor, bytes calldata inputProof, uint256 threshold) external {
        euint256 healthFactor = Nox.fromExternal(encryptedHealthFactor, inputProof);
        euint256 thresholdEncrypted = Nox.toEuint256(threshold);
        ebool isHealthy = healthFactor.gt(thresholdEncrypted);
        healthStatus = isHealthy;
        Nox.allowPublicDecryption(isHealthy);
        emit HealthStatusUpdated(address(this), isHealthy);
    }

    function prepareBorrow(
        externalEuint256 encryptedAmount,
        bytes calldata inputProof
    ) external {
        euint256 amountEncrypted = Nox.fromExternal(encryptedAmount, inputProof);
        amountEncrypted.allow(address(this));
        amountEncrypted.allow(msg.sender);
        Nox.allowPublicDecryption(amountEncrypted);
    }

    function borrow(
        address _asset,
        externalEuint256 encryptedAmount,
        bytes calldata decryptionProof,
        uint256 interestRateMode,
        uint16 referralCode,
        address onBehalfOf
    ) external {
        bytes32 raw = externalEuint256.unwrap(encryptedAmount);
        euint256 amountEncrypted = euint256.wrap(raw);
        uint256 assets = Nox.publicDecrypt(amountEncrypted, decryptionProof);
        require(assets > 0, 'Amount must be > 0');

        if (euint256.unwrap(debtOf[onBehalfOf]) == bytes32(0)) {
            debtOf[onBehalfOf] = amountEncrypted;
        } else {
            debtOf[onBehalfOf] = debtOf[onBehalfOf].add(amountEncrypted);
        }
        debtOf[onBehalfOf].allow(onBehalfOf);
        debtOf[onBehalfOf].allow(address(this));
        IPool(aavePool).borrow(_asset, assets, interestRateMode, referralCode, address(this));
        IERC20(_asset).safeTransfer(onBehalfOf, assets);
        emit Borrowed(onBehalfOf, amountEncrypted, interestRateMode);
    }

    function repay(
        address _asset,
        uint256 assets,
        uint256 interestRateMode,
        address onBehalfOf
    ) external {
        require(assets > 0, 'Amount must be > 0');

        IERC20(_asset).safeTransferFrom(onBehalfOf, address(this), assets);
        IERC20(_asset).forceApprove(aavePool, assets);
        IPool(aavePool).repay(_asset, assets, interestRateMode, address(this));

        euint256 assetsEncrypted = Nox.toEuint256(assets);
        debtOf[onBehalfOf] = debtOf[onBehalfOf].sub(assetsEncrypted);
        debtOf[onBehalfOf].allow(onBehalfOf);
        debtOf[onBehalfOf].allow(address(this));
        emit Repaid(onBehalfOf, assetsEncrypted);
    }
}
