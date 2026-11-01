// Shared frontend state boundary. The current runtime keeps its local store in app.js.
export const uiState = {
  view: "dashboard",
  alarmTab: "live",
  activeWorkOrderId: null,
  traceQuery: ""
};
