// Lets plain Node load the app's lib files, which import siblings without
// a ".js" extension (Next resolves those; Node doesn't).
import { register } from "node:module";

register(
  "data:text/javascript," +
    encodeURIComponent(`
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (err) {
    if (specifier.startsWith(".") && !specifier.endsWith(".js")) return next(specifier + ".js", context);
    throw err;
  }
}`)
);
