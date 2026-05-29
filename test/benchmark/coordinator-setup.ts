import { resetWriteCoordinatorForTests, setWriteCoordinatorTestOverrides } from "../../src/write-coordinator";

const mode = process.env.POIROT_COORDINATOR_MODE;
resetWriteCoordinatorForTests();
if (mode === "mutex-only") {
  setWriteCoordinatorTestOverrides({ fileLock: false });
} else {
  setWriteCoordinatorTestOverrides(null);
}
