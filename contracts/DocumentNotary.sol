// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title DocumentNotary
/// @notice Notarizes documents by recording their SHA-256 hash on-chain along
///         with a timestamp and the submitter's address. Anyone can verify a
///         document's authenticity and provenance by re-hashing the file and
///         checking the record here — the original file itself is never
///         stored on-chain (it lives off-chain, e.g. in Cloudflare R2).
contract DocumentNotary {
    struct Record {
        address submitter;   // who notarized it
        uint256 timestamp;   // block timestamp of notarization
        string  label;       // optional short human-readable label / filename
        bool    exists;      // existence flag (hash => Record lookups default to zero values)
    }

    /// @dev documentHash => Record. documentHash is the SHA-256 hash of the file,
    ///      submitted as a bytes32 value (0x-prefixed hex).
    mapping(bytes32 => Record) private records;

    /// @dev submitter => list of hashes they've notarized, for cheap on-chain enumeration.
    mapping(address => bytes32[]) private submitterHashes;

    /// @notice Total number of documents notarized.
    uint256 public totalNotarized;

    event DocumentNotarized(
        bytes32 indexed documentHash,
        address indexed submitter,
        uint256 timestamp,
        string label
    );

    error AlreadyNotarized(bytes32 documentHash);
    error DocumentNotFound(bytes32 documentHash);

    /// @notice Notarize a new document by its hash.
    /// @param documentHash SHA-256 hash of the document (32 bytes).
    /// @param label Optional short label (e.g. filename) — kept short to save gas.
    function notarize(bytes32 documentHash, string calldata label) external {
        if (records[documentHash].exists) {
            revert AlreadyNotarized(documentHash);
        }

        records[documentHash] = Record({
            submitter: msg.sender,
            timestamp: block.timestamp,
            label: label,
            exists: true
        });

        submitterHashes[msg.sender].push(documentHash);
        totalNotarized += 1;

        emit DocumentNotarized(documentHash, msg.sender, block.timestamp, label);
    }

    /// @notice Verify whether a document hash has been notarized, and fetch its record.
    /// @param documentHash SHA-256 hash to look up.
    /// @return submitter Address that notarized the document.
    /// @return timestamp Block timestamp of notarization.
    /// @return label Human-readable label supplied at notarization time.
    /// @return exists Whether a record exists for this hash.
    function verify(bytes32 documentHash)
        external
        view
        returns (address submitter, uint256 timestamp, string memory label, bool exists)
    {
        Record memory r = records[documentHash];
        return (r.submitter, r.timestamp, r.label, r.exists);
    }

    /// @notice Get all document hashes notarized by a given address.
    function getHashesBySubmitter(address submitter) external view returns (bytes32[] memory) {
        return submitterHashes[submitter];
    }

    /// @notice Convenience view returning how many documents an address has notarized.
    function getSubmitterCount(address submitter) external view returns (uint256) {
        return submitterHashes[submitter].length;
    }
}
