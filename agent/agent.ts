import { defineAgent } from "eve";

export default defineAgent({
  defaultTools: false,
  model: process.env.ANIMATION_MODEL ?? "xiaomi/mimo-v2.6-pro",
});
