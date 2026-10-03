import { Router } from "express";
import { cadExchangeProviders } from "../cadExchange/registry.js";
import { nativeJobCapabilities } from "../nativeJobs.js";

const router = Router();

router.get("/status", (_req, res) => {
  res.json({
    providers: cadExchangeProviders.statuses(),
    nativeCapabilities: nativeJobCapabilities().filter(item => item.adapter === "LibreDWG"),
    openFallbacks: ["dxf", "ifc"],
    message: "DXF and IFC exports remain available. Configured LibreDWG conversion runs through authorized project jobs and retains source files.",
  });
});

export default router;

