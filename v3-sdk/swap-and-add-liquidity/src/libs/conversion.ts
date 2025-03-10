export function fromReadableAmount(amount: number, decimals: number): number {
  return amount * Math.pow(10, decimals)
}
export function toReadableAmount(rawAmount: number, decimals: number): string {
  return (rawAmount / Math.pow(10, decimals)).toString()
}
