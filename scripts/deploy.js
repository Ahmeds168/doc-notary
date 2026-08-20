const hre = require("hardhat");

async function main() {
  console.log("Deploying DocumentNotary...");

  const DocumentNotary = await hre.ethers.getContractFactory("DocumentNotary");
  const notary = await DocumentNotary.deploy();
  await notary.waitForDeployment();

  const address = await notary.getAddress();
  console.log(`DocumentNotary deployed to: ${address}`);
  console.log(`Network: ${hre.network.name}`);
  console.log("\nSet this in your backend .env as CONTRACT_ADDRESS");
  console.log("Set this in your frontend .env as VITE_CONTRACT_ADDRESS");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
