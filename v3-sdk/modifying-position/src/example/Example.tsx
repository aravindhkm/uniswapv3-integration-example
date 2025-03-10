import React, { useCallback, useEffect, useState } from 'react'
import './Example.css'
import { Environment, CurrentConfig } from '../config'
import { getCurrencyBalance } from '../libs/wallet'
import {
  getPositionIds,
  mintPosition,
  addLiquidity,
  removeLiquidity,
} from '../libs/liquidity'
import {
  connectBrowserExtensionWallet,
  getProvider,
  TransactionState,
  getWalletAddress,
} from '../libs/providers'
import { NONFUNGIBLE_POSITION_MANAGER_CONTRACT_ADDRESS } from '../libs/constants'

const useOnBlockUpdated = (callback: (blockNumber: number) => void) => {
  useEffect(() => {
    const subscription = getProvider()?.on('block', callback)
    return () => {
      subscription?.removeAllListeners()
    }
  })
}

const Example = () => {
  const [token0Balance, setToken0Balance] = useState<string>()
  const [token1Balance, setToken1Balance] = useState<string>()
  const [positionIds, setPositionIds] = useState<number[]>([])
  const [txState, setTxState] = useState<TransactionState>(TransactionState.New)
  const [blockNumber, setBlockNumber] = useState<number>(0)

  // Listen for new blocks and update the wallet
  useOnBlockUpdated(async (blockNumber: number) => {
    refreshBalances()
    setBlockNumber(blockNumber)
  })

  // Update wallet state given a block number
  const refreshBalances = useCallback(async () => {
    const provider = getProvider()
    const address = getWalletAddress()
    if (!provider || !address) {
      throw new Error('No provider or address')
    }
    setToken0Balance(
      await getCurrencyBalance(provider, address, CurrentConfig.tokens.token0)
    )
    setToken1Balance(
      await getCurrencyBalance(provider, address, CurrentConfig.tokens.token1)
    )
    setPositionIds(
      await getPositionIds(
        provider,
        address,
        NONFUNGIBLE_POSITION_MANAGER_CONTRACT_ADDRESS
      )
    )
  }, [])

  // Event Handlers

  const onConnectWallet = useCallback(async () => {
    if (await connectBrowserExtensionWallet()) {
      refreshBalances()
    }
  }, [refreshBalances])

  const onMintPosition = useCallback(async () => {
    setTxState(TransactionState.Sending)
    setTxState(await mintPosition())
  }, [])

  const onAddLiquidity = useCallback(async (position: number) => {
    setTxState(TransactionState.Sending)
    setTxState(await addLiquidity(position))
  }, [])

  const onRemoveLiquidity = useCallback(async (position: number) => {
    setTxState(TransactionState.Sending)
    setTxState(await removeLiquidity(position))
  }, [])

  return (
    <div className="App">
      {CurrentConfig.rpc.mainnet === '' && (
        <h2 className="error">Please set your mainnet RPC URL in config.ts</h2>
      )}
      {CurrentConfig.env === Environment.WALLET_EXTENSION &&
        getProvider() === null && (
          <h2 className="error">
            Please install a wallet to use this example configuration
          </h2>
        )}
      <h3>{`Wallet Address: ${getWalletAddress()}`}</h3>
      {CurrentConfig.env === Environment.WALLET_EXTENSION &&
        !getWalletAddress() && (
          <button onClick={onConnectWallet}>Connect Wallet</button>
        )}
      <h3>{`Block Number: ${blockNumber + 1}`}</h3>
      <h3>{`Transaction State: ${txState}`}</h3>
      <h3>{`${CurrentConfig.tokens.token0.symbol} Balance: ${token0Balance}`}</h3>
      <h3>{`${CurrentConfig.tokens.token1.symbol} Balance: ${token1Balance}`}</h3>
      <h3>{`Position Ids: ${positionIds}`}</h3>
      <button
        className="button"
        onClick={onMintPosition}
        disabled={
          txState === TransactionState.Sending ||
          getProvider() === null ||
          CurrentConfig.rpc.mainnet === ''
        }>
        <p>Mint Position</p>
      </button>
      <button
        className="button"
        onClick={() => {
          onAddLiquidity(positionIds[positionIds.length - 1])
        }}
        disabled={
          txState === TransactionState.Sending ||
          getProvider() === null ||
          CurrentConfig.rpc.mainnet === '' ||
          positionIds.length === 0
        }>
        <p>Add Liquidity to Position</p>
      </button>
      <button
        className="button"
        onClick={() => {
          onRemoveLiquidity(positionIds[positionIds.length - 1])
        }}
        disabled={
          txState === TransactionState.Sending ||
          getProvider() === null ||
          CurrentConfig.rpc.mainnet === '' ||
          positionIds.length === 0
        }>
        <p>Remove Liquidity from Position</p>
      </button>
    </div>
  )
}

export default Example
