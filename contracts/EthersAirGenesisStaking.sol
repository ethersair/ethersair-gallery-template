// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title EthersAir Genesis Staking
/// @notice Lock a Genesis edition, accrue on-chain points over time, claim them, unstake.
///         Points are plain uint256 balances held by this contract — no reward token, no
///         inflation, no external dependency. A future token or allowlist can read them.
/// @dev Works with any ERC-721 that supports transferFrom + safeTransferFrom.
contract EthersAirGenesisStaking is IERC721Receiver, Ownable {
    IERC721 public immutable nft;

    /// @notice Points earned per staked token per day (18 decimals).
    uint256 public pointsPerDay;

    struct Stake {
        address owner;
        uint64 since; // last time points were settled
        bool active;
    }

    mapping(uint256 => Stake) public stakes;
    mapping(address => uint256) public points;
    mapping(address => uint256) public stakedBy;

    uint256 public totalStaked;

    event Staked(address indexed user, uint256 indexed tokenId);
    event Unstaked(address indexed user, uint256 indexed tokenId);
    event Claimed(address indexed user, uint256 indexed tokenId, uint256 amount);
    event PointsPerDayUpdated(uint256 value);

    error NotStaker();
    error AlreadyStaked();
    error NotStaked();
    error ZeroAddress();

    constructor(address nft_) Ownable(msg.sender) {
        if (nft_ == address(0)) revert ZeroAddress();
        nft = IERC721(nft_);
        pointsPerDay = 10e18; // 10 points per token per day
    }

    /* ---------------- staking ---------------- */

    function stake(uint256 tokenId) external {
        if (stakes[tokenId].active) revert AlreadyStaked();
        nft.transferFrom(msg.sender, address(this), tokenId);

        stakes[tokenId] = Stake({owner: msg.sender, since: uint64(block.timestamp), active: true});
        stakedBy[msg.sender] += 1;
        totalStaked += 1;

        emit Staked(msg.sender, tokenId);
    }

    function unstake(uint256 tokenId) external {
        Stake memory s = stakes[tokenId];
        if (!s.active || s.owner != msg.sender) revert NotStaker();

        _settle(tokenId);
        delete stakes[tokenId];
        stakedBy[msg.sender] -= 1;
        totalStaked -= 1;

        nft.transferFrom(address(this), msg.sender, tokenId);
        emit Unstaked(msg.sender, tokenId);
    }

    /// @notice Credits accrued points for one staked token and restarts its clock.
    function claim(uint256 tokenId) external returns (uint256 amount) {
        Stake memory s = stakes[tokenId];
        if (!s.active || s.owner != msg.sender) revert NotStaker();

        amount = _settle(tokenId);
        emit Claimed(msg.sender, tokenId, amount);
    }

    /* ---------------- views ---------------- */

    /// @notice Points a staked token has accrued since its last settlement.
    function earned(uint256 tokenId) public view returns (uint256) {
        Stake memory s = stakes[tokenId];
        if (!s.active) return 0;
        return (pointsPerDay * (block.timestamp - s.since)) / 1 days;
    }

    /// @notice Points + pending for a wallet, across all of its staked tokens.
    function totalEarned(address user, uint256[] calldata tokenIds) external view returns (uint256) {
        uint256 total = points[user];
        for (uint256 i = 0; i < tokenIds.length; i++) {
            if (stakes[tokenIds[i]].owner == user) total += earned(tokenIds[i]);
        }
        return total;
    }

    /* ---------------- admin ---------------- */

    function setPointsPerDay(uint256 value) external onlyOwner {
        pointsPerDay = value;
        emit PointsPerDayUpdated(value);
    }

    /* ---------------- internals ---------------- */

    function _settle(uint256 tokenId) internal returns (uint256 amount) {
        Stake storage s = stakes[tokenId];
        amount = (pointsPerDay * (block.timestamp - s.since)) / 1 days;
        if (amount > 0) points[s.owner] += amount;
        s.since = uint64(block.timestamp);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure override returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }
}
