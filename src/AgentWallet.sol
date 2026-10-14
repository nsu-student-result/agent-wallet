// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

contract AgentWallet is ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    address public owner;
    address public agent;

    mapping(address => bool) public allowedToken;
    mapping(address => bool) public allowedRecipient;

    uint256 public maxPerTx;
    uint256 public dailyLimit;
    uint256 public spentToday;
    uint256 public lastSpendDay;

    uint256 public planNonce;

    event AgentSet(address indexed agent);
    event TokenAllowed(address indexed token, bool allowed);
    event RecipientAllowed(address indexed recipient, bool allowed);
    event LimitsSet(uint256 maxPerTx, uint256 dailyLimit);
    event Executed(
        uint256 indexed planId,
        address indexed token,
        address indexed to,
        uint256 amount,
        bytes32 policyHash
    );
    event PolicyRejected(uint256 indexed planId, string reason);
    event Deposited(address indexed token, address indexed from, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    modifier onlyAgent() {
        require(msg.sender == agent, "not agent");
        _;
    }

    constructor(
        address _agent,
        uint256 _maxPerTx,
        uint256 _dailyLimit
    ) {
        owner = msg.sender;
        agent = _agent;
        maxPerTx = _maxPerTx;
        dailyLimit = _dailyLimit;
        lastSpendDay = block.timestamp / 1 days;
        emit AgentSet(_agent);
        emit LimitsSet(_maxPerTx, _dailyLimit);
    }

    // ---------- Owner configuration ----------

    function setAgent(address _agent) external onlyOwner {
        agent = _agent;
        emit AgentSet(_agent);
    }

    function setTokenAllowed(address token, bool allowed) external onlyOwner {
        allowedToken[token] = allowed;
        emit TokenAllowed(token, allowed);
    }

    function setRecipientAllowed(address recipient, bool allowed) external onlyOwner {
        allowedRecipient[recipient] = allowed;
        emit RecipientAllowed(recipient, allowed);
    }

    function setLimits(uint256 _maxPerTx, uint256 _dailyLimit) external onlyOwner {
        maxPerTx = _maxPerTx;
        dailyLimit = _dailyLimit;
        emit LimitsSet(_maxPerTx, _dailyLimit);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ---------- Funding ----------

    function deposit(address token, uint256 amount) external {
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(token, msg.sender, amount);
    }

    // ---------- Policy check (read-only) ----------

    function checkPolicy(
        address token,
        address to,
        uint256 amount
    ) public view returns (bool ok, string memory reason) {
        if (paused()) return (false, "wallet is paused");
        if (!allowedToken[token]) return (false, "token not allowed");
        if (!allowedRecipient[to]) return (false, "recipient not allowed");
        if (amount == 0) return (false, "amount is zero");
        if (amount > maxPerTx) return (false, "exceeds max per transaction");
        if (_projectedSpend() + amount > dailyLimit) {
            return (false, "exceeds daily limit");
        }
        return (true, "");
    }

    // ---------- Execution ----------

    function executeTransfer(
        uint256 planId,
        address token,
        address to,
        uint256 amount
    ) external onlyAgent nonReentrant whenNotPaused {
        (bool ok, string memory reason) = checkPolicy(token, to, amount);
        if (!ok) {
            emit PolicyRejected(planId, reason);
            revert(reason);
        }

        _recordSpend(amount);

        IERC20(token).safeTransfer(to, amount);

        bytes32 policyHash = keccak256(
            abi.encode(planId, token, to, amount, block.timestamp)
        );
        emit Executed(planId, token, to, amount, policyHash);
    }

    // ---------- Internal helpers ----------

    function _projectedSpend() internal view returns (uint256) {
        uint256 today = block.timestamp / 1 days;
        if (today != lastSpendDay) {
            return 0;
        }
        return spentToday;
    }

    function _recordSpend(uint256 amount) internal {
        uint256 today = block.timestamp / 1 days;
        if (today != lastSpendDay) {
            lastSpendDay = today;
            spentToday = 0;
        }
        spentToday += amount;
    }
}