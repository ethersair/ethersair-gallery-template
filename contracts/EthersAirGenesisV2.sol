// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC4906} from "@openzeppelin/contracts/interfaces/IERC4906.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @title EthersAir Genesis v2
/// @notice Numbered ERC-721 collection with tiered pricing, collection-level metadata
///         (`contractURI`, read by marketplaces) and explicit `.json` token URIs.
/// @dev Differences from v1, each one fixing a real production problem:
///      1. `contractURI()` + `setContractURI()` — OpenSea reads name/logo/banner/fee from
///         the chain, so the collection does not need a manual claim step.
///      2. `tokenURI` returns `<baseURI><id>.json`, so metadata files keep their extension.
///      3. ERC-4906 events on base-URI changes, so marketplaces refresh cached metadata.
contract EthersAirGenesisV2 is ERC721, ERC2981, Ownable, IERC4906 {
    using Strings for uint256;

    uint256 public constant MAX_SUPPLY = 656;

    uint256 public tier1End = 50;
    uint256 public tier2End = 200;
    uint256 public tier3End = 600;

    uint256 public tier1Price;
    uint256 public tier2Price;
    uint256 public tier3Price;
    uint256 public tier4Price;

    string private _baseTokenURI;
    string private _contractMetadataURI;

    bool public mintOpen;
    uint256 public totalMinted;

    event Minted(address indexed to, uint256 indexed tokenId, uint256 price);
    event PricesUpdated(uint256 p1, uint256 p2, uint256 p3, uint256 p4);
    event MintToggled(bool open);
    event BaseURIUpdated(string uri);
    event ContractURIUpdated(string uri);

    error InvalidTokenId();
    error AlreadyMinted();
    error MintClosed();
    error WrongPayment(uint256 expected, uint256 sent);
    error TransferFailed();

    constructor(
        address initialOwner,
        string memory baseURI_,
        string memory contractURI_,
        address royaltyReceiver,
        uint96 royaltyBps,
        uint256 p1,
        uint256 p2,
        uint256 p3,
        uint256 p4
    ) ERC721("EthersAir Genesis", "EAG") Ownable(initialOwner) {
        require(royaltyBps <= 1000, "royalty too high");
        _baseTokenURI = baseURI_;
        _contractMetadataURI = contractURI_;
        _setDefaultRoyalty(royaltyReceiver, royaltyBps);
        tier1Price = p1;
        tier2Price = p2;
        tier3Price = p3;
        tier4Price = p4;
    }

    /* ---------------- pricing ---------------- */

    function priceOf(uint256 tokenId) public view returns (uint256) {
        if (tokenId == 0 || tokenId > MAX_SUPPLY) revert InvalidTokenId();
        if (tokenId <= tier1End) return tier1Price;
        if (tokenId <= tier2End) return tier2Price;
        if (tokenId <= tier3End) return tier3Price;
        return tier4Price;
    }

    /* ---------------- mint ---------------- */

    function mint(uint256 tokenId) external payable {
        if (!mintOpen) revert MintClosed();
        uint256 price = priceOf(tokenId);
        if (msg.value != price) revert WrongPayment(price, msg.value);
        if (_ownerOf(tokenId) != address(0)) revert AlreadyMinted();

        totalMinted += 1;
        _safeMint(msg.sender, tokenId);
        emit Minted(msg.sender, tokenId, price);
    }

    function setMintOpen(bool open) external onlyOwner {
        mintOpen = open;
        emit MintToggled(open);
    }

    function setPrices(uint256 p1, uint256 p2, uint256 p3, uint256 p4) external onlyOwner {
        tier1Price = p1;
        tier2Price = p2;
        tier3Price = p3;
        tier4Price = p4;
        emit PricesUpdated(p1, p2, p3, p4);
    }

    /* ---------------- metadata ---------------- */

    /// @notice Explicit `.json` suffix, matching how metadata is usually published.
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return string.concat(_baseTokenURI, tokenId.toString(), ".json");
    }

    /// @notice Collection-level metadata (name, description, image, banner, fee) for marketplaces.
    function contractURI() external view returns (string memory) {
        return _contractMetadataURI;
    }

    function setBaseURI(string calldata uri) external onlyOwner {
        _baseTokenURI = uri;
        emit BaseURIUpdated(uri);
        emit BatchMetadataUpdate(1, MAX_SUPPLY);
    }

    function setContractURI(string calldata uri) external onlyOwner {
        _contractMetadataURI = uri;
        emit ContractURIUpdated(uri);
    }

    function setRoyalty(address receiver, uint96 bps) external onlyOwner {
        require(bps <= 1000, "royalty too high");
        _setDefaultRoyalty(receiver, bps);
    }

    function withdraw(address payable to) external onlyOwner {
        (bool ok, ) = to.call{value: address(this).balance}("");
        if (!ok) revert TransferFailed();
    }

    function remaining() external view returns (uint256) {
        return MAX_SUPPLY - totalMinted;
    }

    /* ---------------- erc165 ---------------- */

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC2981, IERC165)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
