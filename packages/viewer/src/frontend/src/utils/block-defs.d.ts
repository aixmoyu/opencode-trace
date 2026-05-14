export interface Block {
    type: string;
    text?: string;
    thinking?: string;
    name?: string;
    description?: string;
    parameters?: unknown;
    arguments?: string;
    toolCallId?: string;
    content?: string;
    data?: unknown;
}
export interface BlockDef {
    tag: string;
    toggle: boolean;
    renderMeta: ((b: Block) => string) | null;
    getRaw: ((b: Block) => string) | null;
    renderRaw: ((b: Block) => string) | null;
    renderRendered: ((raw: string) => string) | null;
}
export declare const BLOCK_DEFS: Record<string, BlockDef>;
export declare function formatJsonLines(obj: unknown): string;
export declare function formatXmlLines(xml: string): string;
export declare function renderContent(content: string): string;
//# sourceMappingURL=block-defs.d.ts.map