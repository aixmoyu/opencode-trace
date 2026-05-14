import { ref } from "vue";

export interface Toast {
  id: number;
  message: string;
  type: "success" | "error" | "info" | "warning";
  actionLabel?: string;
  onAction?: () => void;
}

const toasts = ref<Toast[]>([]);
let nextId = 0;

export function useToast() {
  function showToast(
    message: string,
    type: Toast["type"] = "info",
    onAction?: () => void,
    actionLabel?: string,
    duration = 3000
  ) {
    const id = nextId++;
    const toast: Toast = { id, message, type, actionLabel, onAction };
    toasts.value.push(toast);

    setTimeout(() => {
      toasts.value = toasts.value.filter((t) => t.id !== id);
    }, duration);
  }

  function removeToast(id: number) {
    toasts.value = toasts.value.filter((t) => t.id !== id);
  }

  return { toasts, showToast, removeToast };
}

export const toastState = toasts;
