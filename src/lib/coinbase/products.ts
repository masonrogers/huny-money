import { coinbaseRequest } from './client';
import type { GetProductResponse, Product, ListProductsResponse } from './types';

// ─── Products ──────────────────────────────────────────────────────────────

/**
 * Get details for a specific product (trading pair).
 *
 * GET /api/v3/brokerage/products/{product_id}
 *
 * Returns pricing info, trading limits, increment sizes, and status.
 *
 * @param productId - e.g., "BTC-USD", "ETH-USD", "SOL-USD"
 */
export async function getProduct(productId: string): Promise<GetProductResponse> {
  return coinbaseRequest<GetProductResponse>({
    method: 'GET',
    path: `/api/v3/brokerage/products/${productId}`,
  });
}

/**
 * List all available products on Coinbase Advanced Trade.
 *
 * GET /api/v3/brokerage/products
 *
 * Can be filtered by product_type. Returns all trading pairs with
 * their current prices, volumes, and trading parameters.
 *
 * @param productType - Optional filter, e.g., "SPOT"
 */
export async function listProducts(
  productType?: string,
): Promise<Product[]> {
  const params: Record<string, string | undefined> = {};
  if (productType) {
    params.product_type = productType;
  }

  const response = await coinbaseRequest<ListProductsResponse>({
    method: 'GET',
    path: '/api/v3/brokerage/products',
    params,
  });

  return response.products;
}

/**
 * Get products for the bot's tradeable assets only.
 * Filters the full product list to BTC-USD, ETH-USD, SOL-USD
 * (and any additional pairs specified).
 */
export async function getTradingProducts(
  pairs: string[] = ['BTC-USD', 'ETH-USD', 'SOL-USD'],
): Promise<Product[]> {
  const products = await listProducts('SPOT');
  const pairSet = new Set(pairs.map((p) => p.toUpperCase()));
  return products.filter((p) => pairSet.has(p.product_id.toUpperCase()));
}
