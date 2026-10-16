import { useEffect, useState } from "react";
import { getNetwork } from "./api.js";

/** Network details from the backend config, or null while loading / unavailable. */
export function useNetwork() {
  const [network, setNetwork] = useState(null);
  useEffect(() => {
    let active = true;
    getNetwork()
      .then((n) => active && setNetwork(n))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  return network;
}

export function explorerTxUrl(network, txHash) {
  return network?.explorerUrl && txHash ? `${network.explorerUrl}/tx/${txHash}` : null;
}

export function explorerAddressUrl(network, address) {
  return network?.explorerUrl && address ? `${network.explorerUrl}/address/${address}` : null;
}
