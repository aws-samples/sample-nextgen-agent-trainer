import { Router, Request, Response } from "express";
import { getScenariosByBusiness, getScenario, getAvailableBusinesses } from "./dynamodb-service";

const router = Router();

// GET /api/scenarios/businesses - list available business verticals
router.get("/businesses", async (req: Request, res: Response) => {
  try {
    const businesses = await getAvailableBusinesses();
    res.json({ businesses });
  } catch (error) {
    console.error("Error fetching businesses:", error);
    res.status(500).json({ error: "Failed to fetch businesses" });
  }
});

// GET /api/scenarios?business=telco
router.get("/", async (req: Request, res: Response) => {
  try {
    const business = req.query.business as string;

    if (!business) {
      return res.status(400).json({ error: "business parameter is required" });
    }

    const scenarios = await getScenariosByBusiness(business);
    res.json({ scenarios });
  } catch (error) {
    console.error("Error fetching scenarios:", error);
    res.status(500).json({ error: "Failed to fetch scenarios" });
  }
});

// GET /api/scenarios/:scenarioId?business=telco
router.get("/:scenarioId", async (req: Request, res: Response) => {
  try {
    const scenarioId = req.params.scenarioId as string;
    const business = req.query.business as string;

    if (!business) {
      return res.status(400).json({ error: "business parameter is required" });
    }

    const scenario = await getScenario(business, scenarioId);

    if (!scenario) {
      return res.status(404).json({ error: "Scenario not found" });
    }

    res.json(scenario);
  } catch (error) {
    console.error("Error fetching scenario:", error);
    res.status(500).json({ error: "Failed to fetch scenario" });
  }
});

export default router;
