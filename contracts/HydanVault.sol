// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title IPoolAddressesProvider - Aave V3 Pool Addresses Provider
interface IPoolAddressesProvider {
    function getPool() external view returns (address);
}

/// @title IPool - Aave V3 Pool interface
interface IPool {
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;
    function withdraw(address asset, uint256 amount, address to) external returns (uint256);
    function borrow(address asset, uint256 amount, uint16 interestRateMode, uint16 referralCode, address onBehalfOf) external;
    function repay(address asset, uint256 amount, uint16 interestRateMode, address onBehalfOf) external returns (uint256);
}

/// @title IProtocolDataProvider - Aave V3 Protocol Data Provider
interface IProtocolDataProvider {
    function getReserveTokensAddresses(address asset) external view returns (address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress);
}

/// @title HydanVault
/// @notice Pooled vault with ERC-4626-style share accounting, single Aave counterparty
contract HydanVault {
    using SafeERC20 for IERC20;

    /// @notice Emitted when vault is initialized
    event VaultInitialized(address indexed asset, address indexed aavePool);

    /// @notice Emitted when a deposit is made
    event Deposited(address indexed user, uint256 assets, uint256 shares);

    /// @notice Emitted when a withdrawal is made
    event Withdrawn(address indexed user, uint256 assets, uint256 shares);

    /// @notice Emitted when a borrow is made
    event Borrowed(address indexed user, uint256 assets, uint16 interestRateMode);

    /// @notice Emitted when a repayment is made
    event Repaid(address indexed user, uint256 assets, uint16 interestRateMode);

    /// @notice The underlying asset (e.g., USDC, DAI)
    address public immutable asset;

    /// @notice Aave V3 Pool address
    address public aavePool;

    /// @notice Aave V3 PoolAddressesProvider address
    address public immutable aavePoolAddressesProvider;

    /// @notice Aave aToken for the asset (represents vault's position in Aave)
    address public aToken;

    /// @notice Total shares minted
    uint256 public totalShares;

    /// @notice Shares per user
    mapping(address => uint256) public balanceOf;

    constructor(
        address _asset,
        address _aavePoolAddressesProvider
    ) {
        asset = _asset;
        aavePoolAddressesProvider = _aavePoolAddressesProvider;
        // aavePool set via setAavePool() after deployment for testing
        emit VaultInitialized(asset, address(0));
    }

    /// @notice Set Aave Pool address (call once after deployment)
    function setAavePool(address _aavePool) external {
        require(aavePool == address(0), "aavePool already set");
        aavePool = _aavePool;
    }

    /// @notice Set aToken address (call once after deployment)
    function setAToken(address _aToken) external {
        require(aToken == address(0), "aToken already set");
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

    /// @notice Preview assets needed for a given share amount
    function previewMint(uint256 shares) public view returns (uint256) {
        if (totalShares == 0) return shares;
        return (shares * totalAssets()) / totalShares;
    }

    /// @notice Preview shares burned for a given asset amount
    function previewWithdraw(uint256 assets) public view returns (uint256) {
        if (totalShares == 0) return assets;
        return (assets * totalShares) / totalAssets();
    }

    /// @notice Preview assets received for a given share amount
    function previewRedeem(uint256 shares) public view returns (uint256) {
        if (totalShares == 0) return shares;
        return (shares * totalAssets()) / totalShares;
    }

    /// @notice Deposit assets, receive shares
    function deposit(uint256 assets, address receiver) external returns (uint256 shares) {
        require(assets > 0, "Amount must be > 0");
        shares = previewDeposit(assets);
        require(shares > 0, "Zero shares");

        IERC20(asset).safeTransferFrom(msg.sender, address(this), assets);
        IERC20(asset).forceApprove(aavePool, assets);
        IPool(aavePool).supply(asset, assets, address(this), 0);

        totalShares += shares;
        balanceOf[receiver] += shares;

        emit Deposited(receiver, assets, shares);
        return shares;
    }

    /// @notice Mint specific shares, pay required assets
    function mint(uint256 shares, address receiver) external returns (uint256 assets) {
        require(shares > 0, "Shares must be > 0");
        assets = previewMint(shares);
        require(assets > 0, "Zero assets");

        IERC20(asset).safeTransferFrom(msg.sender, address(this), assets);
        IERC20(asset).forceApprove(aavePool, assets);
        IPool(aavePool).supply(asset, assets, address(this), 0);

        totalShares += shares;
        balanceOf[receiver] += shares;

        emit Deposited(receiver, assets, shares);
        return assets;
    }

    /// @notice Withdraw assets by burning shares
    function withdraw(uint256 assets, address receiver, address owner) external returns (uint256 shares) {
        require(assets > 0, "Amount must be > 0");
        shares = previewWithdraw(assets);
        require(shares > 0, "Zero shares");
        require(balanceOf[owner] >= shares, "Insufficient shares");

        uint256 withdrawn = IPool(aavePool).withdraw(asset, assets, address(this));
        IERC20(asset).safeTransfer(receiver, withdrawn);

        totalShares -= shares;
        balanceOf[owner] -= shares;

        emit Withdrawn(owner, withdrawn, shares);
        return shares;
    }

    /// @notice Redeem specific shares for assets
    function redeem(uint256 shares, address receiver, address owner) external returns (uint256 assets) {
        require(shares > 0, "Shares must be > 0");
        require(balanceOf[owner] >= shares, "Insufficient shares");

        assets = previewRedeem(shares);
        require(assets > 0, "Zero assets");

        uint256 withdrawn = IPool(aavePool).withdraw(asset, assets, address(this));
        IERC20(asset).safeTransfer(receiver, withdrawn);

        totalShares -= shares;
        balanceOf[owner] -= shares;

        emit Withdrawn(owner, withdrawn, shares);
        return assets;
    }

    /// @notice Borrow from Aave (vault is counterparty)
    function borrow(uint256 assets, uint16 interestRateMode, uint16 referralCode, address onBehalfOf) external {
        require(assets > 0, "Amount must be > 0");
        IPool(aavePool).borrow(asset, assets, interestRateMode, referralCode, address(this));
        IERC20(asset).safeTransfer(onBehalfOf, assets);
        emit Borrowed(onBehalfOf, assets, interestRateMode);
    }

    /// @notice Repay to Aave
    function repay(uint256 assets, uint16 interestRateMode, address onBehalfOf) external {
        require(assets > 0, "Amount must be > 0");
        IERC20(asset).safeTransferFrom(onBehalfOf, address(this), assets);
        IERC20(asset).forceApprove(aavePool, assets);
        IPool(aavePool).repay(asset, assets, interestRateMode, address(this));
        emit Repaid(onBehalfOf, assets, interestRateMode);
    }
}