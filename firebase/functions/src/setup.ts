import { initializeApp } from "firebase-admin/app";
import { setGlobalOptions } from "firebase-functions/v2";

// Once per instance, before any function: the hub's region (its firebase/functions/src/setup.ts), so the app's
// getFunctions(app, "asia-southeast1") finds Post-It's functions where it finds the hub's.
initializeApp();
setGlobalOptions({ region: "asia-southeast1", maxInstances: 10 });
