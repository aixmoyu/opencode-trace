import { createRouter, createWebHashHistory } from "vue-router";
import SessionsView from "./views/SessionsView.vue";
import TimelineView from "./views/TimelineView.vue";
import RecordView from "./views/RecordView.vue";

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", name: "sessions", component: SessionsView },
    { path: "/session/:sessionId", name: "timeline", component: TimelineView, props: true },
    { path: "/session/:sessionId/record/:recordId", name: "record", component: RecordView, props: true },
    { path: "/:pathMatch(.*)*", redirect: "/" },
  ],
});

export default router;
