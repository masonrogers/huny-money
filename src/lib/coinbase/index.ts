// ─── Coinbase Advanced Trade API Client ─────────────────────────────────────
// Re-exports for convenient imports:
//   import { getAccounts, placeOrder, getCandles } from '@/lib/coinbase';

export * from './types';
export { coinbaseRequest } from './client';
export { getAccounts, getBalance, getAllBalances } from './accounts';
export {
  getCandles,
  getTicker,
  getProduct as getMarketProduct,
  getMidPrice,
  getMultiTimeframeCandles,
} from './market-data';
export {
  placeOrder,
  placeLimitOrder,
  placeMarketOrder,
  placeStopLimitOrder,
  getOrder,
  listOrders,
  cancelOrders,
} from './orders';
export {
  getProduct,
  listProducts,
  getTradingProducts,
} from './products';
