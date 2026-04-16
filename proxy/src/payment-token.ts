export const XLAYER_CHAIN_INDEX = "196";
export const XLAYER_USDT_SYMBOL = "USDT";
export const XLAYER_USDT_ADDRESS = "0x779ded0c9e1022225f8e0630b35a9b54be713736";
export const XLAYER_USDT_DECIMALS = 6;

export function isXLayerUsdtAsset(asset: any): boolean {
  const chainIndex = String(asset?.chainIndex ?? "");
  const symbol = String(asset?.symbol ?? asset?.tokenSymbol ?? "").toUpperCase();
  const address = String(
    asset?.tokenContractAddress ??
    asset?.contractAddress ??
    asset?.address ??
    "",
  ).toLowerCase();

  return (
    chainIndex === XLAYER_CHAIN_INDEX &&
    (symbol === XLAYER_USDT_SYMBOL || address === XLAYER_USDT_ADDRESS)
  );
}
