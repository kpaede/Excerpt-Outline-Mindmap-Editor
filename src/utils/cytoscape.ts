export function sortByMarkdownOrder(a: any, b: any): number {
  return (a.data('order') ?? 0) - (b.data('order') ?? 0);
}
