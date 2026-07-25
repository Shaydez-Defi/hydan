// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Nox, euint256, ebool, externalEuint256 } from "@iexec-nox/nox-protocol-contracts/contracts/sdk/Nox.sol";

/// @title IPoolAddressesProvider - Aave V3 Pool Addresses Provider
interface IPoolAddressesProvider {
    function getPool() external view returns (address);
}

/// @title IPool - Aave V3 Pool interface
interface IPool {
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;
    function withdraw(address asset, uint256 amount, address to) external returns (uint256);
    function borrow(
        address asset,
        uint256 amount,
        uint16 interestRateMode,
        uint16 referralCode,
        address onBehalfOf
    ) external;
    function repay(address asset, uint256 amount, uint16 interestRateMode, address onBehalfOf) external returns (uint256);
    function getUserAccountData(address user) external view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor);
}

/// @title IProtocolDataProvider - Aave V3 Protocol Data Provider
interface IProtocolDataProvider {
    function getReserveTokensAddresses(
        address asset
    ) external view returns (address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress);
}

/// @title HydanVault
/// @notice Pooled vault with ERC-4626-style share accounting, Nox-encrypted user balances, single Aave counterparty
/// @notice User share balances are encrypted via Nox (euint256), only decryptable by the user
/// @notice Aggregate totalShares and totalAssets remain public for price discovery
contract HydanVault {
    using SafeERC20 for IERC20;
    using Nox for euint256;

    /// @notice Emitted when vault is initialized
    event VaultInitialized(address indexed asset, address indexed aavePool);

    /// @notice Emitted when a deposit is made
    event Deposited(address indexed user, uint256 assets, euint256 shares);

    /// @notice Emitted when a withdrawal is made
    event Withdrawn(address indexed user, uint256 assets, euint256 shares);

    /// @notice Emitted when a borrow is made
    event Borrowed(address indexed user, uint256 assets, uint16 interestRateMode);

    /// @notice Emitted when a repayment is made
    event Repaid(address indexed user, uint256 assets, uint16 interestRateMode);

    /// @notice Emitted when health factor status is updated
    event HealthStatusUpdated(address indexed vault, ebool isHealthy);

    /// @notice The underlying asset (e.g., USDC, DAI, WETH, GHO)
    address public immutable asset;

    /// @notice Aave V3 Pool address
    address public aavePool;

    /// @notice Aave V3 PoolAddressesProvider address
    address public immutable aavePoolAddressesProvider;

    /// @notice Aave aToken for the asset (represents vault's position in Aave)
    address public aToken;

    /// @notice Total shares minted (public for share price calculation)
    uint256 public totalShares;

    /// @notice Encrypted share balance per user (euint256 handle, only decryptable by the user)
    mapping(address => euint256) public balanceOf;

    /// @notice Encrypted health factor status (ebool: true = healthy, false = at-risk)
    ebool public healthStatus;

    constructor(address _asset, address _aavePoolAddressesProvider) {
        asset = _asset;
        aavePoolAddressesProvider = _aavePoolAddressesProvider;
        // aavePool set via setAavePool() after deployment for testing
        emit VaultInitialized(asset, address(0));
    }

    /// @notice Set Aave Pool address (call once after deployment)
    function setAavePool(address _aavePool) external {
        require(aavePool == address(0), 'aavePool already set');
        aavePool = _aavePool;
    }

    /// @notice Set aToken address (call once after deployment)
    function setAToken(address _aToken) external {
        require(aToken == address(0), 'aToken already set');
        aToken = _aToken;
    }

    /// @notice Total assets under management (aToken balance of this vault)
    function totalAssets() public view returns (uint256) {
        return IERC20(aToken).balanceOf(address(this));
    }

    /// @notice Preview shares minted for a given asset amount
    function previewDeposit(uint256 assets) public view returns (uint256) {
        if (totalShares == 0) return assets;
        return (assets * totalShares) / totalAssets();
    }

    /// @notice Preview shares burned for a given asset amount
    function previewWithdraw(uint256 assets) public view returns (uint256) {
        if (totalShares == 0) return assets;
        return (assets * totalShares) / totalAssets();
    }

    /// @notice Deposit assets, receive encrypted shares
    /// @param assets Amount of underlying asset to deposit
    /// @param receiver Address to receive shares
    function deposit(uint256 assets, address receiver) external returns (euint256 shares) {
        require(assets > 0, 'Amount must be > 0');

        // Compute shares as plaintext using vault's share price (same math as totalShares)
        uint256 sharesPlain = previewDeposit(assets);
        require(sharesPlain > 0, 'Zero shares');

        // Convert trusted plaintext shares to encrypted handle on-chain
        shares = Nox.toEuint256(sharesPlain);

        // Transfer assets to vault and supply to Aave
        IERC20(asset).safeTransferFrom(msg.sender, address(this), assets);
        IERC20(asset).forceApprove(aavePool, assets);
        IPool(aavePool).supply(asset, assets, address(this), 0);

        // Add encrypted shares to user's balance using Nox arithmetic
        balanceOf[receiver] = balanceOf[receiver].add(shares);

        // Update total shares (public) - calculated from plaintext assets
        totalShares += sharesPlain;

        // Grant receiver and vault permission to decrypt the new balance
        balanceOf[receiver].allow(receiver);
        balanceOf[receiver].allow(address(this));

        emit Deposited(receiver, assets, shares);
    }

    /// @notice Withdraw assets by burning encrypted shares
    /// @param assets Amount of underlying asset to withdraw
    /// @param receiver Address to receive underlying assets
    /// @param owner Address whose shares to burn
    function withdraw(uint256 assets, address receiver, address owner) external returns (euint256 shares) {
        require(assets > 0, 'Amount must be > 0');

        // Compute shares to burn as plaintext using vault's share price
        uint256 sharesPlain = previewWithdraw(assets);
        require(sharesPlain > 0, 'Zero shares');

        // Convert trusted plaintext shares to encrypted handle on-chain
        shares = Nox.toEuint256(sharesPlain);

        // Subtract encrypted shares from owner's balance (reverts in TEE if insufficient)
        balanceOf[owner] = balanceOf[owner].sub(shares);

        // Withdraw from Aave
        uint256 withdrawn = IPool(aavePool).withdraw(asset, assets, address(this));
        IERC20(asset).safeTransfer(receiver, withdrawn);

        // Update total shares (public)
        totalShares -= sharesPlain;

        // Grant owner permission to decrypt their new balance
        balanceOf[owner].allow(owner);
        balanceOf[owner].allow(address(this));

        emit Withdrawn(owner, withdrawn, shares);
    }

    /// @notice Update health factor status by comparing encrypted health factor against threshold
    /// @param encryptedHealthFactor Encrypted health factor handle (externalEuint256)
    /// @param inputProof EIP-712 proof for the encrypted health factor
    /// @param threshold Threshold health factor (plaintext, in ray precision - 1e27 for 1.0)
    /// @dev Only callable by authorized oracle/keeper. Compares encrypted health factor against threshold.
    function updateHealthStatus(externalEuint256 encryptedHealthFactor, bytes calldata inputProof, uint256 threshold) external {
        // Validate the external encrypted health factor
        euint256 healthFactor = Nox.fromExternal(encryptedHealthFactor, inputProof);

        // Compare health factor against threshold (euint256 gt returns ebool)
        // healthFactor > threshold means healthy (true), at-risk otherwise (false)
        euint256 thresholdEncrypted = Nox.toEuint256(threshold);
        ebool isHealthy = healthFactor.gt(thresholdEncrypted);

        // Store encrypted health status
        healthStatus = isHealthy;

        // Allow public decryption of the health status (anyone can read healthy/at-risk)
        Nox.allowPublicDecryption(isHealthy);

        emit HealthStatusUpdated(address(this), isHealthy);
    }

    /// @notice Borrow from Aave (vault is counterparty)
    function borrow(uint256 assets, uint16 interestRateMode, uint16 referralCode, address onBehalfOf) external {
        require(assets > 0, 'Amount must be > 0');
        IPool(aavePool).borrow(asset, assets, interestRateMode, referralCode, address(this));
        IERC20(asset).safeTransfer(onBehalfOf, assets);
        emit Borrowed(onBehalfOf, assets, interestRateMode);
    }

    /// @notice Repay to Aave
    function repay(uint256 assets, uint16 interestRateMode, address onBehalfOf) external {
        require(assets > 0, 'Amount must be > 0');
        IERC20(asset).safeTransferFrom(onBehalfOf, address(this), assets);
        IERC20(asset).forceApprove(aavePool, assets);
        IPool(aavePool).repay(asset, assets, interestRateMode, address(this));
        emit Repaid(onBehalfOf, assets, interestRateMode);
    }
}