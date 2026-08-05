/**
 * cytoscape-dagre ships no type declarations. Declaring the single thing this
 * plugin uses - registering a Cytoscape extension - is enough to drop the
 * `@ts-ignore` and the unchecked value that followed from it, without
 * pretending to describe a library we only call once.
 */
declare module 'cytoscape-dagre' {
  import type { Ext } from 'cytoscape';

  const dagre: Ext;
  export default dagre;
}
