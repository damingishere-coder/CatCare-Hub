export interface OrderNumberReference {
  order_number?: number | null;
  order_id?: number | null;
  id?: number | null;
}

export function displayOrderNumber(reference: OrderNumberReference): number | "?" {
  return reference.order_number ?? reference.order_id ?? reference.id ?? "?";
}
