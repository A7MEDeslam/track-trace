/*
 * Track & Trace domain model.
 * The browser prototype uses this module for deterministic local workflows.
 * It intentionally keeps source files and review decisions immutable by
 * creating versions/events instead of overwriting operational history.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.FactoryCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const STATUS = Object.freeze({
    DRAFT: "draft", PENDING_QA: "pending_qa", APPROVED: "approved",
    XML_READY: "xml_ready", SERIALIZATION_IN_PROGRESS: "serialization_in_progress",
    SERIALIZATION_COMPLETE: "serialization_complete", SERIALS_GENERATED: "serials_generated",
    READY_FOR_AGGREGATION: "ready_for_aggregation", AGGREGATION_IN_PROGRESS: "aggregation_in_progress",
    AGGREGATION_COMPLETE: "aggregation_complete", READY_FOR_SUBMISSION: "ready_for_submission",
    SUBMITTED: "submitted", ACCEPTED: "accepted", CORRECTION_REQUIRED: "correction_required",
    REJECTED: "rejected", ON_HOLD: "on_hold", CLOSED: "closed"
  });
  const SUBMISSION_STATUS = Object.freeze({ PENDING: "pending", ACCEPTED: "accepted", REJECTED: "rejected", CORRECTION_REQUIRED: "correction_required" });
  const QA_STATUS = Object.freeze({ PENDING: "pending", APPROVED: "approved", REJECTED: "rejected", NEEDS_CORRECTION: "needs_correction" });
  const now = () => new Date().toISOString();
  const id = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  const assert = (condition, message) => { if (!condition) throw new Error(message); };

  function validateWorkOrderInput(input) {
    assert(input && typeof input === "object", "Work Order data is required.");
    ["name", "productName", "gtin", "batch", "quantity", "manufacturingDate", "expiryDate", "sourceGln"]
      .forEach((field) => assert(input[field] !== undefined && input[field] !== "", `${field} is required.`));
    assert(/^\d{8,14}$/.test(String(input.gtin)), "GTIN must contain 8–14 digits.");
    assert(/^\d{13}$/.test(String(input.sourceGln)), "Source GLN must contain 13 digits.");
    assert(Number.isInteger(Number(input.quantity)) && Number(input.quantity) > 0, "Quantity must be a positive integer.");
    assert(new Date(input.expiryDate) > new Date(input.manufacturingDate), "Expiry date must be after manufacturing date.");
  }

  function createMaterial(input = {}) {
    assert(input.code && input.name && input.gtin, "Material code, name, and GTIN are required.");
    assert(/^\d{8,14}$/.test(String(input.gtin)), "GTIN must contain 8–14 digits.");
    return { id: input.id || id("MAT"), code: String(input.code), name: String(input.name), gtin: String(input.gtin), gln: String(input.gln || ""), baseUnit: input.baseUnit || "Pack", shelfLife: Number(input.shelfLife || 0), batchSize: Number(input.batchSize || 0), storage: input.storage || "Temperature not exceeding 25°C", status: input.status || "active", createdAt: now(), updatedAt: now() };
  }

  function createRecipe(input = {}) {
    assert(input.materialId && input.description, "Recipe material and description are required.");
    const levels = Array.isArray(input.levels) && input.levels.length ? input.levels : [{ key: "unit", label: "Unit", childCount: 1 }, { key: "shrink", label: "Shrink", childCount: 10 }, { key: "case", label: "Case", childCount: 5 }, { key: "pallet", label: "Pallet", childCount: 20 }];
    levels.forEach((level) => assert(level.childCount > 0, "Every aggregation level needs a positive child count."));
    return { id: input.id || id("REC"), materialId: String(input.materialId), description: String(input.description), levels: levels.map((level, index) => ({ ...level, order: index })), lines: input.lines || [], aggregationMachineId: input.aggregationMachineId || "", version: input.version || 1, status: input.status || "active", createdAt: now(), updatedAt: now() };
  }

  function createWorkOrder(input) {
    validateWorkOrderInput(input);
    return { id: input.id || id("WO"), name: String(input.name), productName: String(input.productName), materialId: input.materialId || "", gtin: String(input.gtin), batch: String(input.batch), quantity: Number(input.quantity), manufacturingDate: input.manufacturingDate, expiryDate: input.expiryDate, sourceGln: String(input.sourceGln), site: input.site || "", line: input.line || "", recipeId: input.recipeId || "", recipeVersion: input.recipeVersion || 1, serializationMachineId: input.serializationMachineId || "", aggregationMachineId: input.aggregationMachineId || "", storage: input.storage || "Temperature not exceeding 25°C", status: STATUS.DRAFT, serials: [], machineFiles: [], qaReviews: [], aggregationSessions: [], submissions: [], warehouseEvents: [], events: [{ type: "work_order_created", at: now() }], createdAt: now(), updatedAt: now() };
  }

  function generateSerials(workOrder, options = {}) {
    assert(workOrder && [STATUS.DRAFT, STATUS.APPROVED].includes(workOrder.status), "Serials can only be generated for an approved or draft Work Order.");
    const startAt = Number.isInteger(options.startAt) ? options.startAt : 1;
    const requested = workOrder.quantity;
    const maxRows = Number.isInteger(options.maxRows) && options.maxRows > 0 ? options.maxRows : requested;
    const sampleSize = Math.min(requested, maxRows);
    const width = Math.max(8, String(requested + startAt - 1).length);
    workOrder.serialCount = requested;
    workOrder.serials = Array.from({ length: sampleSize }, (_, index) => ({ serial: String(startAt + index).padStart(width, "0"), gtin: workOrder.gtin, batch: workOrder.batch, expiryDate: workOrder.expiryDate, sourceGln: workOrder.sourceGln, status: "generated", parentId: null }));
    workOrder.serialSummary = { generated: requested, accepted: 0, rejected: 0, sampledRows: sampleSize };
    workOrder.status = STATUS.SERIALS_GENERATED;
    workOrder.updatedAt = now();
    workOrder.events.push({ type: "serials_generated", count: requested, sampledRows: sampleSize, at: now() });
    return workOrder;
  }

  function createMachineXml(workOrder) {
    assert(workOrder && workOrder.serials.length, "Generate serials before creating machine XML.");
    assert(![STATUS.CLOSED, STATUS.SUBMITTED].includes(workOrder.status), "This Work Order is closed or already submitted.");
    const version = workOrder.machineFiles.filter((file) => file.type === "serialization_machine_xml").length + 1;
    const omitted = Math.max(0, (workOrder.serialCount || workOrder.quantity) - workOrder.serials.length);
    const body = [`<workOrder id="${workOrder.id}">`, `  <gtin>${workOrder.gtin}</gtin>`, `  <batch>${workOrder.batch}</batch>`, `  <quantity>${workOrder.quantity}</quantity>`, `  <manufacturingDate>${workOrder.manufacturingDate}</manufacturingDate>`, `  <expiryDate>${workOrder.expiryDate}</expiryDate>`, "  <serials>", ...workOrder.serials.map((row) => `    <serial>${row.serial}</serial>`), ...(omitted ? [`    <!-- ${omitted} additional serials are represented by this review sample -->`] : []), "  </serials>", "</workOrder>"].join("\n");
    const file = { id: id("FILE"), type: "serialization_machine_xml", name: `${workOrder.id}-serialization-v${version}.xml`, version, content: body, status: "pending_qa", createdAt: now() };
    workOrder.machineFiles.push(file);
    workOrder.status = STATUS.PENDING_QA;
    workOrder.events.push({ type: "machine_xml_created", fileId: file.id, version, at: now() });
    workOrder.updatedAt = now();
    return file;
  }

  function validateSerials(workOrder) {
    assert(workOrder && workOrder.serials, "Work Order serials are required.");
    const errors = [], seen = new Set();
    workOrder.serials.forEach((row, index) => {
      const rowNo = index + 1;
      if (!row.serial) errors.push({ row: rowNo, code: "missing_serial", message: "Serial is required." });
      if (seen.has(row.serial)) errors.push({ row: rowNo, code: "duplicate_serial", message: `Serial ${row.serial} is duplicated.` });
      seen.add(row.serial);
      if (row.gtin !== workOrder.gtin) errors.push({ row: rowNo, code: "gtin_mismatch", message: "GTIN does not match the Work Order." });
      if (row.batch !== workOrder.batch) errors.push({ row: rowNo, code: "batch_mismatch", message: "Batch does not match the Work Order." });
      if (!/^\d+$/.test(String(row.serial || ""))) errors.push({ row: rowNo, code: "invalid_serial", message: "Serial must contain digits only." });
    });
    const rejectedRows = new Set(errors.map((error) => error.row));
    return { valid: errors.length === 0, total: workOrder.serials.length, accepted: workOrder.serials.length - rejectedRows.size, rejected: rejectedRows.size, errors };
  }

  function createMachineResult(workOrder, options = {}) {
    assert(workOrder && workOrder.serials.length, "Machine XML must exist before receiving a result.");
    const rejectCount = Number.isInteger(options.rejectCount) ? options.rejectCount : 0;
    const logicalRejectCount = Math.min(Math.max(0, rejectCount), workOrder.quantity);
    const sampleRejectCount = Math.min(logicalRejectCount, workOrder.serials.length);
    workOrder.serials.forEach((row, index) => { row.status = index >= workOrder.serials.length - sampleRejectCount ? "rejected" : "accepted"; row.rejectReason = row.status === "rejected" ? (options.reason || "Unreadable code") : ""; });
    workOrder.serialSummary = { generated: 0, accepted: workOrder.quantity - logicalRejectCount, rejected: logicalRejectCount, sampledRows: workOrder.serials.length };
    const result = { id: id("MRES"), type: "serialization_result", status: "pending_qa", requested: workOrder.quantity, accepted: workOrder.serialSummary.accepted, rejected: logicalRejectCount, rows: workOrder.serials.map((row) => ({ ...row })), sampledRows: workOrder.serials.length, receivedAt: now() };
    workOrder.machineFiles.push(result);
    workOrder.status = STATUS.SERIALIZATION_COMPLETE;
    workOrder.events.push({ type: "serialization_result_received", resultId: result.id, accepted: result.accepted, rejected: result.rejected, at: now() });
    workOrder.updatedAt = now();
    return result;
  }

  function reviewWorkOrder(workOrder) {
    const result = validateSerials(workOrder);
    workOrder.lastValidation = { ...result, reviewedAt: now() };
    workOrder.updatedAt = now();
    // Keep the result available for both the legacy submission API and the
    // newer aggregation-first UI. The UI decides which next step is unlocked.
    workOrder.status = result.valid ? STATUS.READY_FOR_SUBMISSION : STATUS.SERIALS_GENERATED;
    workOrder.events.push({ type: "serials_reviewed", valid: result.valid, errors: result.errors.length, at: now() });
    return result;
  }

  function createQaReview(workOrder, file, kind) {
    const review = { id: id("QA"), workOrderId: workOrder.id, fileId: file.id, fileName: file.name || file.type, kind, status: QA_STATUS.PENDING, reviewer: null, comments: "", createdAt: now(), decidedAt: null };
    workOrder.qaReviews.push(review);
    file.qaReviewId = review.id;
    file.status = "pending_qa";
    return review;
  }

  function decideQa(workOrder, reviewId, decision, comments = "") {
    const review = workOrder.qaReviews.find((item) => item.id === reviewId);
    assert(review, "QA review not found.");
    assert([QA_STATUS.APPROVED, QA_STATUS.REJECTED, QA_STATUS.NEEDS_CORRECTION].includes(decision), "Invalid QA decision.");
    review.status = decision; review.comments = comments; review.reviewer = "Ahmed El-Sayed"; review.decidedAt = now();
    const file = workOrder.machineFiles.find((item) => item.qaReviewId === reviewId);
    if (file) file.status = decision;
    workOrder.events.push({ type: "qa_decision", reviewId, decision, at: now() });
    workOrder.updatedAt = now();
    return review;
  }

  function createAggregationSession(workOrder, recipe, levelKey = "shrink") {
    assert(workOrder.serials.some((row) => row.status === "accepted" || row.status === "generated"), "No units available for aggregation.");
    const machineResult = workOrder.machineFiles.find((file) => file.type === "serialization_result");
    const resultReview = machineResult && workOrder.qaReviews.find((review) => review.fileId === machineResult.id);
    assert(machineResult && resultReview && resultReview.status === QA_STATUS.APPROVED, "QA must approve the Serialization machine result before aggregation can start.");
    const level = recipe.levels.find((item) => item.key === levelKey) || recipe.levels[1];
    return { id: id("AGG"), workOrderId: workOrder.id, recipeId: recipe.id, level: level.key, levelLabel: level.label, expectedChildren: level.childCount, parentSerial: null, children: [], status: "scanning", machineStatus: "online", cameraStatus: "online", startedAt: now(), closedAt: null, file: null };
  }

  function addAggregationScan(session, serial) {
    assert(session && session.status === "scanning", "Aggregation session is not active.");
    assert(serial, "A serial is required.");
    if (session.children.includes(serial)) throw new Error("This child was already scanned into the parent.");
    session.children.push(serial);
    return session;
  }

  function closeAggregationParent(workOrder, session, parentSerial) {
    assert(session && session.children.length === session.expectedChildren, `Parent needs ${session.expectedChildren} children before it can close.`);
    assert(parentSerial, "Parent serial from aggregation machine is required.");
    session.parentSerial = parentSerial; session.status = "sealed"; session.closedAt = now();
    session.children.forEach((serial) => { const child = workOrder.serials.find((row) => row.serial === serial); if (child) { child.status = "aggregated"; child.parentId = parentSerial; } });
    const file = { id: id("FILE"), type: "aggregation_xml", name: `${workOrder.id}-${parentSerial}-aggregation.xml`, version: 1, status: "pending_qa", content: `<aggregation parent="${parentSerial}">\n${session.children.map((child) => `  <child>${child}</child>`).join("\n")}\n</aggregation>`, createdAt: now() };
    session.file = file; workOrder.machineFiles.push(file); workOrder.aggregationSessions.push(session); workOrder.status = STATUS.AGGREGATION_COMPLETE; workOrder.events.push({ type: "parent_sealed", parentSerial, childCount: session.children.length, at: now() });
    return file;
  }

  function createSubmission(workOrder, type = "commissioning") {
    assert(workOrder.status === STATUS.READY_FOR_SUBMISSION || workOrder.status === STATUS.READY_FOR_AGGREGATION || workOrder.status === STATUS.AGGREGATION_COMPLETE || workOrder.status === STATUS.CORRECTION_REQUIRED, "A successful review / QA approval is required before submission.");
    assert(workOrder.machineFiles.length > 0 && workOrder.machineFiles.every((file) => file.status === QA_STATUS.APPROVED), "Every generated file must be approved by QA before submission.");
    const submission = { id: id("SUB"), workOrderId: workOrder.id, type, version: workOrder.submissions.filter((item) => item.type === type).length + 1, status: SUBMISSION_STATUS.PENDING, payload: workOrder.serials.filter((row) => row.status !== "rejected").map(({ serial, gtin, batch, expiryDate, sourceGln, parentId }) => ({ serial, gtin, batch, expiryDate, sourceGln, parentId })), createdAt: now(), response: null };
    workOrder.submissions.push(submission); workOrder.status = STATUS.SUBMITTED; workOrder.events.push({ type: "submission_created", submissionId: submission.id, at: now() }); workOrder.updatedAt = now(); return submission;
  }

  function applyAuthorityResponse(workOrder, submissionId, response) {
    const submission = workOrder.submissions.find((item) => item.id === submissionId); assert(submission, "Submission not found."); assert(Object.values(SUBMISSION_STATUS).includes(response.status), "Invalid authority response status.");
    submission.status = response.status; submission.response = { receivedAt: now(), ...response }; workOrder.status = response.status === SUBMISSION_STATUS.ACCEPTED ? STATUS.ACCEPTED : response.status === SUBMISSION_STATUS.CORRECTION_REQUIRED ? STATUS.CORRECTION_REQUIRED : STATUS.REJECTED; workOrder.events.push({ type: "authority_response", submissionId, status: response.status, at: now() }); workOrder.updatedAt = now(); return submission;
  }

  function recordWarehouseEvent(workOrder, event) { const movement = { id: id("MOVE"), type: event.type, serial: event.serial, location: event.location, quantity: event.quantity || 1, user: event.user || "Warehouse Operator", at: now(), status: event.status || "recorded" }; workOrder.warehouseEvents.push(movement); workOrder.events.push({ type: `warehouse_${event.type}`, movementId: movement.id, at: movement.at }); return movement; }
  function toCsv(workOrder) { assert(workOrder && workOrder.serials.length, "No serials available to export."); const escape = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`; return [["GTIN", "Serial", "Batch", "Expiry", "SourceGLN", "Status", "Parent"], ...workOrder.serials.map((row) => [row.gtin, row.serial, row.batch, row.expiryDate, row.sourceGln, row.status, row.parentId || ""])].map((row) => row.map(escape).join(",")).join("\n"); }
  function dashboardMetrics(workOrders) { const list = Array.isArray(workOrders) ? workOrders : []; const serials = list.flatMap((workOrder) => workOrder.serials || []); const submissions = list.flatMap((workOrder) => workOrder.submissions || []); return { workOrders: list.length, openWorkOrders: list.filter((item) => ![STATUS.ACCEPTED, STATUS.REJECTED, STATUS.CLOSED].includes(item.status)).length, serialsGenerated: serials.length, submissionsPending: submissions.filter((item) => item.status === SUBMISSION_STATUS.PENDING).length, submissionsAccepted: submissions.filter((item) => item.status === SUBMISSION_STATUS.ACCEPTED).length, submissionsRejected: submissions.filter((item) => [SUBMISSION_STATUS.REJECTED, SUBMISSION_STATUS.CORRECTION_REQUIRED].includes(item.status)).length }; }

  return { STATUS, SUBMISSION_STATUS, QA_STATUS, createMaterial, createRecipe, createWorkOrder, generateSerials, createMachineXml, validateSerials, createMachineResult, reviewWorkOrder, createQaReview, decideQa, createAggregationSession, addAggregationScan, closeAggregationParent, createSubmission, applyAuthorityResponse, recordWarehouseEvent, toCsv, dashboardMetrics };
});
