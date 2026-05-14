import { ref } from "vue";
const toasts = ref([]);
let nextId = 0;
export function useToast() {
    function showToast(message, type = "info", onAction, actionLabel, duration = 3000) {
        const id = nextId++;
        const toast = { id, message, type, actionLabel, onAction };
        toasts.value.push(toast);
        setTimeout(() => {
            toasts.value = toasts.value.filter((t) => t.id !== id);
        }, duration);
    }
    function removeToast(id) {
        toasts.value = toasts.value.filter((t) => t.id !== id);
    }
    return { toasts, showToast, removeToast };
}
export const toastState = toasts;
//# sourceMappingURL=useToast.js.map