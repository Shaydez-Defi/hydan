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

/// @title HydanVault
/// @notice Vault contract integrating Nox confidential computing with Aave V3 on Sepolia
contract HydanVault {
    using SafeERC20 for IERC20;

    /// @notice Emitted when vault is initialized
    event VaultInitialized(address indexed owner, address indexed aavePool);

    /// @notice Emitted when a deposit is made
    event Deposited(address indexed user, address indexed asset, uint256 amount);

    /// @notice Emitted when a withdrawal is made
    event Withdrawn(address indexed user, address indexed asset, uint256 amount);

    /// @notice Emitted when a borrow is made
    event Borrowed(address indexed user, address indexed asset, uint256 amount, uint16 interestRateMode);

    /// @notice Emitted when a repayment is made
    event Repaid(address indexed user, address indexed asset, uint256 amount);

    address public immutable owner;
    address public immutable aavePool;
    address public immutable aavePoolAddressesProvider;

    constructor(
        address _aavePoolAddressesProvider
    ) {
        owner = msg.sender;
        aavePoolAddressesProvider = _aavePoolAddressesProvider;
        aavePool = IPoolAddressesProvider(_aavePoolAddressesProvider).getPool();
        emit VaultInitialized(owner, aavePool);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /// @notice Deposit asset into Aave via vault
    /// @param asset Asset address to deposit
    /// @param amount Amount to deposit
    /// @param referralCode Referral code for Aave
    function deposit(address asset, uint256 amount, uint16 referralCode) external onlyOwner {
        require(amount > 0, "Amount must be > 0");
        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        IERC20(asset).forceApprove(aavePool, amount);
        IPool(aavePool).supply(asset, amount, address(this), referralCode);
        emit Deposited(msg.sender, asset, amount);
    }

    /// @notice Withdraw asset from Aave via vault
    /// @param asset Asset address to withdraw
    /// @param amount Amount to withdraw (type(uint256).max for max)
    function withdraw(address asset, uint256 amount) external onlyOwner {
        require(amount > 0, "Amount must be > 0");
        uint256 withdrawn = IPool(aavePool).withdraw(asset, amount, address(this));
        IERC20(asset).safeTransfer(msg.sender, withdrawn);
        emit Withdrawn(msg.sender, asset, withdrawn);
    }

    /// @notice Borrow asset from Aave via vault
    /// @param asset Asset address to borrow
    /// @param amount Amount to borrow
    /// @param interestRateMode Interest rate mode (1 = stable, 2 = variable)
    /// @param referralCode Referral code for Aave
    function borrow(address asset, uint256 amount, uint16 interestRateMode, uint16 referralCode) external onlyOwner {
        require(amount > 0, "Amount must be > 0");
        IPool(aavePool).borrow(asset, amount, interestRateMode, referralCode, address(this));
        IERC20(asset).safeTransfer(msg.sender, amount);
        emit Borrowed(msg.sender, asset, amount, interestRateMode);
    }

    /// @notice Repay borrowed asset to Aave via vault
    /// @param asset Asset address to repay
    /// @param amount Amount to repay (type(uint256).max for max)
    function repay(address asset, uint256 amount) external onlyOwner {
        require(amount > 0, "Amount must be > 0");
        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        IERC20(asset).forceApprove(aavePool, amount);
        IPool(aavePool).repay(asset, amount, 2, address(this)); // 2 = variable rate
        emit Repaid(msg.sender, asset, amount);
    }

    /// @notice Emergency withdrawal of any ERC20 stuck in vault
    /// @param token Token to withdraw
    /// @param to Recipient address
    /// @param amount Amount to withdraw
    function emergencyWithdraw(address token, address to, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
    }

    error NotOwner();
}