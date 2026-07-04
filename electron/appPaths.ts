import { app } from "electron";
import { join } from "node:path";

/** 便携版由 electron-builder 注入，指向 .exe 所在目录。 */
const portableExecutableDir = process.env.PORTABLE_EXECUTABLE_DIR;

/**
 * 便携版将 userData 放在 exe 旁的 data/，便于拷贝与删除；
 * 须在 app.ready 之前、任何 getPath("userData") 之前调用。
 */
export const configureUserDataPath = (): void => {
  if (!portableExecutableDir) {
    return;
  }

  app.setPath("userData", join(portableExecutableDir, "data"));
};
