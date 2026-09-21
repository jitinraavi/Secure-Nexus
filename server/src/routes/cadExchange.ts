import { Router } from "express";
import { cadExchangeProviders } from "../cadExchange/registry.js";

const router = Router();

router.get("/status", (_req, res) => {
  res.json({
    providers: cadExchangeProviders.statuses(),
    openFallbacks: ["dxf", "ifc"],
    message: "DXF and IFC remain available as open fallback exports. DWG is never represented by a renamed or synthetic file.",
  });
});

export default router;
