import { onMounted, onUnmounted } from "vue";
export function useKeyboard(handlers) {
    function onKeydown(e) {
        const handler = handlers[e.key];
        if (handler) {
            const activeEl = document.activeElement;
            const isInput = activeEl?.tagName === "INPUT" ||
                activeEl?.tagName === "TEXTAREA" ||
                activeEl?.tagName === "SELECT" ||
                activeEl?.isContentEditable;
            if (!isInput || e.key === "Escape") {
                e.preventDefault();
                handler(e);
            }
        }
    }
    onMounted(() => document.addEventListener("keydown", onKeydown));
    onUnmounted(() => document.removeEventListener("keydown", onKeydown));
}
//# sourceMappingURL=useKeyboard.js.map