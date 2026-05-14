export interface Toast {
    id: number;
    message: string;
    type: "success" | "error" | "info" | "warning";
    actionLabel?: string;
    onAction?: () => void;
}
export declare function useToast(): {
    toasts: import("vue").Ref<{
        id: number;
        message: string;
        type: "success" | "error" | "info" | "warning";
        actionLabel?: string | undefined;
        onAction?: (() => void) | undefined;
    }[], Toast[] | {
        id: number;
        message: string;
        type: "success" | "error" | "info" | "warning";
        actionLabel?: string | undefined;
        onAction?: (() => void) | undefined;
    }[]>;
    showToast: (message: string, type?: Toast["type"], onAction?: () => void, actionLabel?: string, duration?: number) => void;
    removeToast: (id: number) => void;
};
export declare const toastState: import("vue").Ref<{
    id: number;
    message: string;
    type: "success" | "error" | "info" | "warning";
    actionLabel?: string | undefined;
    onAction?: (() => void) | undefined;
}[], Toast[] | {
    id: number;
    message: string;
    type: "success" | "error" | "info" | "warning";
    actionLabel?: string | undefined;
    onAction?: (() => void) | undefined;
}[]>;
//# sourceMappingURL=useToast.d.ts.map