const assert = require('node:assert/strict');
const core = require('./factory-core');

function makeWorkOrder(quantity = 3) {
  return core.createWorkOrder({
    name: 'WO-260921-004',
    productName: 'Betaderm 20 GM Cream',
    gtin: '06221032024426',
    batch: '260921',
    quantity,
    manufacturingDate: '2026-09-21',
    expiryDate: '2029-09-20',
    sourceGln: '6221032000002',
  });
}

const workOrder = makeWorkOrder();
assert.equal(workOrder.status, core.STATUS.DRAFT);
core.generateSerials(workOrder);
assert.equal(workOrder.serials.length, 3);
assert.equal(new Set(workOrder.serials.map((row) => row.serial)).size, 3);

const review = core.reviewWorkOrder(workOrder);
assert.equal(review.valid, true);
assert.equal(workOrder.status, core.STATUS.READY_FOR_SUBMISSION);
const machineFile = core.createMachineXml(workOrder);
const machineQa = core.createQaReview(workOrder, machineFile, 'Machine XML');
core.decideQa(workOrder, machineQa.id, core.QA_STATUS.APPROVED, 'Reviewed in test');
core.reviewWorkOrder(workOrder);

const submission = core.createSubmission(workOrder);
assert.equal(submission.status, core.SUBMISSION_STATUS.PENDING);
assert.equal(workOrder.status, core.STATUS.SUBMITTED);

core.applyAuthorityResponse(workOrder, submission.id, { status: core.SUBMISSION_STATUS.ACCEPTED });
assert.equal(workOrder.status, core.STATUS.ACCEPTED);
assert.match(core.toCsv(workOrder), /^"GTIN","Serial","Batch","Expiry","SourceGLN"/);

const broken = makeWorkOrder(2);
core.generateSerials(broken);
broken.serials[1].serial = broken.serials[0].serial;
const failedReview = core.reviewWorkOrder(broken);
assert.equal(failedReview.valid, false);
assert.ok(failedReview.errors.some((error) => error.code === 'duplicate_serial'));
assert.throws(() => core.createSubmission(broken), /successful review/);

const sampled = makeWorkOrder(18000);
core.generateSerials(sampled, { maxRows: 240 });
assert.equal(sampled.serials.length, 240);
assert.equal(sampled.serialCount, 18000);
const sampledXml = core.createMachineXml(sampled);
const sampledResult = core.createMachineResult(sampled, { rejectCount: 3 });
assert.equal(sampledResult.accepted, 17997);
assert.equal(sampledResult.rejected, 3);
assert.equal(sampled.serialSummary.accepted, 17997);
assert.equal(sampled.machineFiles.length, 2);
assert.match(sampledXml.content, /additional serials are represented by this review sample/);

console.log('factory-core: all tests passed');
