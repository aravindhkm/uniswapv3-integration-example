import { ethers } from 'ethers'
import {
  ERC20_ABI,
  NONFUNGIBLE_POSITION_MANAGER_ABI,
  MAX_FEE_PER_GAS,
  MAX_PRIORITY_FEE_PER_GAS,
  NONFUNGIBLE_POSITION_MANAGER_CONTRACT_ADDRESS,
  V3_SWAP_ROUTER_ADDRESS,
} from './constants'
import { TOKEN_AMOUNT_TO_APPROVE_FOR_TRANSFER } from './constants'
import {
  getMainnetProvider,
  sendTransaction,
  TransactionState,
} from './providers'
import {
  Pool,
  Position,
  nearestUsableTick,
  MintOptions,
  NonfungiblePositionManager,
} from '@uniswap/v3-sdk'
import { CurrentConfig } from '../config'
import { getPoolInfo } from './pool'
import { getProvider, getWalletAddress } from './providers'
import { Percent, CurrencyAmount, Token, Fraction } from '@uniswap/sdk-core'
import { fromReadableAmount } from './conversion'
import {
  AlphaRouter,
  SwapAndAddConfig,
  SwapAndAddOptions,
  SwapToRatioResponse,
  SwapToRatioRoute,
  SwapToRatioStatus,
  SwapType,
} from '@uniswap/smart-order-router'

export async function swapAndAddLiquidity(
  positionId: number
): Promise<TransactionState> {
  const address = getWalletAddress()
  const provider = getProvider()
  if (!address || !provider) {
    return TransactionState.Failed
  }

  const router = new AlphaRouter({ chainId: 1, provider: getMainnetProvider() })

  const swapAndAddConfig: SwapAndAddConfig = {
    ratioErrorTolerance: new Fraction(1, 100),
    maxIterations: 6,
  }

  const swapAndAddOptions: SwapAndAddOptions = {
    swapOptions: {
      type: SwapType.SWAP_ROUTER_02,
      recipient: address,
      slippageTolerance: new Percent(5, 100),
      deadline: 60 * 20,
    },
    addLiquidityOptions: {
      tokenId: positionId,
    },
  }

  const token1CurrencyAmount = CurrencyAmount.fromRawAmount(
    CurrentConfig.tokens.token0,
    fromReadableAmount(
      CurrentConfig.tokens.token0Amount,
      CurrentConfig.tokens.token0.decimals
    )
  )

  const token0CurrencyAmount = CurrencyAmount.fromRawAmount(
    CurrentConfig.tokens.token1,
    fromReadableAmount(
      CurrentConfig.tokens.token1Amount,
      CurrentConfig.tokens.token1.decimals
    )
  )

  const currentPosition = await constructPosition(
    token0CurrencyAmount,
    token1CurrencyAmount
  )

  const routeToRatioResponse: SwapToRatioResponse = await router.routeToRatio(
    token0CurrencyAmount,
    token1CurrencyAmount,
    currentPosition,
    swapAndAddConfig,
    swapAndAddOptions
  )

  if (
    !routeToRatioResponse ||
    routeToRatioResponse.status !== SwapToRatioStatus.SUCCESS
  ) {
    return TransactionState.Failed
  }

  const route: SwapToRatioRoute = routeToRatioResponse.result
  const transaction = {
    data: route.methodParameters?.calldata,
    to: V3_SWAP_ROUTER_ADDRESS,
    value: route.methodParameters?.value,
    from: address,
  }

  return sendTransaction(transaction)
}

export async function getPositionIds(
  provider: ethers.providers.Provider,
  address: string,
  contractAddress: string
): Promise<number[]> {
  // Get currency otherwise
  const positionContract = new ethers.Contract(
    contractAddress,
    NONFUNGIBLE_POSITION_MANAGER_ABI,
    provider
  )
  // Get number of positions
  const balance: number = await positionContract.balanceOf(address)

  // Get all positions
  const tokenIds = []
  for (let i = 0; i < balance; i++) {
    const tokenOfOwnerByIndex: number =
      await positionContract.tokenOfOwnerByIndex(address, i)
    tokenIds.push(tokenOfOwnerByIndex)
  }

  return tokenIds
}

export async function getTokenTransferApprovals(
  provider: ethers.providers.Provider,
  tokenAddress: string,
  fromAddress: string,
  toAddress: string
): Promise<TransactionState> {
  if (!provider) {
    console.log('No Provider Found')
    return TransactionState.Failed
  }

  try {
    const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider)

    const transaction = await tokenContract.populateTransaction.approve(
      toAddress,
      TOKEN_AMOUNT_TO_APPROVE_FOR_TRANSFER
    )

    return await sendTransaction({
      ...transaction,
      from: fromAddress,
    })
  } catch (e) {
    console.error(e)
    return TransactionState.Failed
  }
}

export async function constructPosition(
  token0Amount: CurrencyAmount<Token>,
  token1Amount: CurrencyAmount<Token>
): Promise<Position> {
  // get pool info
  const poolInfo = await getPoolInfo()

  // construct pool instance
  const configuredPool = new Pool(
    token0Amount.currency,
    token1Amount.currency,
    poolInfo.fee,
    poolInfo.sqrtPriceX96.toString(),
    poolInfo.liquidity.toString(),
    poolInfo.tick
  )

  // create position using the maximum liquidity from input amounts
  return new Position({
    pool: configuredPool,
    tickLower:
      nearestUsableTick(poolInfo.tick, poolInfo.tickSpacing) -
      poolInfo.tickSpacing * 2,
    tickUpper:
      nearestUsableTick(poolInfo.tick, poolInfo.tickSpacing) +
      poolInfo.tickSpacing * 2,

    liquidity: 1,
  })
}

export async function mintPosition(): Promise<TransactionState> {
  const address = getWalletAddress()
  const provider = getProvider()
  if (!address || !provider) {
    return TransactionState.Failed
  }

  // Give approval to the contract to transfer tokens
  const tokenInApproval = await getTokenTransferApprovals(
    provider,
    CurrentConfig.tokens.token0.address,
    address,
    NONFUNGIBLE_POSITION_MANAGER_CONTRACT_ADDRESS
  )
  const tokenOutApproval = await getTokenTransferApprovals(
    provider,
    CurrentConfig.tokens.token1.address,
    address,
    NONFUNGIBLE_POSITION_MANAGER_CONTRACT_ADDRESS
  )

  if (
    tokenInApproval !== TransactionState.Sent ||
    tokenOutApproval !== TransactionState.Sent
  ) {
    return TransactionState.Failed
  }

  const minPositionOptions: MintOptions = {
    recipient: address,
    deadline: Math.floor(Date.now() / 1000) + 60 * 20,
    slippageTolerance: new Percent(50, 10_000),
  }

  const positionToMint = await constructPosition(
    CurrencyAmount.fromRawAmount(
      CurrentConfig.tokens.token0,
      fromReadableAmount(
        CurrentConfig.tokens.token0Amount,
        CurrentConfig.tokens.token0.decimals
      )
    ),
    CurrencyAmount.fromRawAmount(
      CurrentConfig.tokens.token1,
      fromReadableAmount(
        CurrentConfig.tokens.token1Amount,
        CurrentConfig.tokens.token1.decimals
      )
    )
  )

  // get calldata for minting a position
  const { calldata, value } = NonfungiblePositionManager.addCallParameters(
    positionToMint,
    minPositionOptions
  )

  // build transaction
  const transaction = {
    data: calldata,
    to: NONFUNGIBLE_POSITION_MANAGER_CONTRACT_ADDRESS,
    value: value,
    from: address,
    maxFeePerGas: MAX_FEE_PER_GAS,
    maxPriorityFeePerGas: MAX_PRIORITY_FEE_PER_GAS,
  }

  return sendTransaction(transaction)
}
