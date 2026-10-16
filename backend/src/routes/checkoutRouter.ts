import { Router } from "express";
import { createCheckout } from "../controllers/checkoutContollers";

const router = Router();

router.post("/", createCheckout);
export default router;
