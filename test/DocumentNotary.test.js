const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DocumentNotary", function () {
  let notary, owner, other;
  const sampleHash = ethers.keccak256(ethers.toUtf8Bytes("sample-document-content"));

  beforeEach(async function () {
    [owner, other] = await ethers.getSigners();
    const DocumentNotary = await ethers.getContractFactory("DocumentNotary");
    notary = await DocumentNotary.deploy();
    await notary.waitForDeployment();
  });

  it("notarizes a new document and emits an event", async function () {
    await expect(notary.notarize(sampleHash, "invoice-2026.pdf"))
      .to.emit(notary, "DocumentNotarized")
      .withArgs(sampleHash, owner.address, await currentBlockTimestamp(), "invoice-2026.pdf");

    expect(await notary.totalNotarized()).to.equal(1);
  });

  it("returns correct data on verify()", async function () {
    await notary.notarize(sampleHash, "contract-final.pdf");
    const [submitter, timestamp, label, exists] = await notary.verify(sampleHash);

    expect(submitter).to.equal(owner.address);
    expect(label).to.equal("contract-final.pdf");
    expect(exists).to.equal(true);
    expect(timestamp).to.be.gt(0);
  });

  it("returns exists=false for an unnotarized hash", async function () {
    const unknownHash = ethers.keccak256(ethers.toUtf8Bytes("never-submitted"));
    const [, , , exists] = await notary.verify(unknownHash);
    expect(exists).to.equal(false);
  });

  it("reverts when notarizing the same hash twice", async function () {
    await notary.notarize(sampleHash, "first.pdf");
    await expect(notary.notarize(sampleHash, "duplicate.pdf"))
      .to.be.revertedWithCustomError(notary, "AlreadyNotarized")
      .withArgs(sampleHash);
  });

  it("tracks hashes per submitter", async function () {
    const hash2 = ethers.keccak256(ethers.toUtf8Bytes("second-doc"));

    await notary.connect(owner).notarize(sampleHash, "doc1.pdf");
    await notary.connect(other).notarize(hash2, "doc2.pdf");

    const ownerHashes = await notary.getHashesBySubmitter(owner.address);
    const otherHashes = await notary.getHashesBySubmitter(other.address);

    expect(ownerHashes).to.deep.equal([sampleHash]);
    expect(otherHashes).to.deep.equal([hash2]);
    expect(await notary.getSubmitterCount(owner.address)).to.equal(1);
  });

  async function currentBlockTimestamp() {
    const block = await ethers.provider.getBlock("latest");
    return block.timestamp + 1; // +1 because the notarize tx will be in the next block
  }
});
