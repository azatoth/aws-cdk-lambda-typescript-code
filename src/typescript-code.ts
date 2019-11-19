import { AssetCode, Code, CodeConfig } from "@aws-cdk/aws-lambda";
import { Construct } from "@aws-cdk/core";
import { gray, green, red, white } from "chalk";
import { execFileSync } from "child_process";
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  statSync,
  unlinkSync,
  utimesSync,
} from "fs";
import { removeSync } from "fs-extra";
import { join } from "path";
import { readdirSync } from "readdir-enhanced";
export abstract class TypeScriptCode extends Code {
  /**
   * Loads the function code from a directory
   * @param path The path to the directory containing the typescript code
   */
  public static fromAsset(path: string): TypeScriptAssetCode {
    return new TypeScriptAssetCode(path);
  }
}

/**
 * Extension for AssetCode to run a TypeScript build step before deployment
 *
 * @export
 * @class TypeScriptAssetCode
 * @extends {AssetCode}
 */
export class TypeScriptAssetCode extends AssetCode {
  /**
   * original source code path
   *
   * @private
   * @type {string}
   */
  private typeScriptSourcePath: string; // original source code path
  /**
   * list of source code paths already built in this session
   *
   * @private
   * @static
   * @type {string[]}
   */
  private static typeScriptAlreadyBuilt: string[] = [];

  public constructor(path: string) {
    // Add a .deploy subfolder which contains the built files and is deployed to S3
    super(join(path, ".deploy"));
    // Remember the original source folder
    this.typeScriptSourcePath = path;
  }
  public bind(construct: Construct): CodeConfig {
    this.typeScriptBuild();
    return super.bind(construct);
  }

  private typeScriptBuild(): void {
    // Keep track of which folders have already been built
    if (
      TypeScriptAssetCode.typeScriptAlreadyBuilt.includes(
        this.typeScriptSourcePath
      )
    ) {
      return;
    }
    TypeScriptAssetCode.typeScriptAlreadyBuilt.push(this.typeScriptSourcePath);

    const stampFile = `${this.path}.stamp`;
    // Only continue with build if we have something new to build
    if (existsSync(stampFile)) {
      const mtime = statSync(stampFile).mtime;
      const newer_files = readdirSync(this.typeScriptSourcePath, {
        deep: /^(?!node_modules|\.deploy)*$/,
        filter: stats => {
          return stats.isFile() && stats.mtime > mtime;
        },
      });
      if (newer_files.length === 0) {
        // nothing new to build
        return;
      }
    }
    process.stdout.write(
      `${gray("Packaging")} ${white(this.typeScriptSourcePath)}... `
    );
    // Clean out current build
    try {
      if (existsSync(this.path)) {
        removeSync(this.path);
      }
      mkdirSync(this.path);


      execFileSync(
        "npm",
        ["install", "--loglevel", "error", "--no-optional", "--no-audit"],
        {
          cwd: this.typeScriptSourcePath,
        }
      );
      execFileSync("npx", ["tsc", "--outDir", ".deploy", "--skipLibCheck"], {
        cwd: this.typeScriptSourcePath,
      });

      if (existsSync(join(this.typeScriptSourcePath, "package.json"))) {
        copyFileSync(
          join(this.typeScriptSourcePath, "package.json"),
          join(this.path, "package.json")
        );

        if (existsSync(join(this.typeScriptSourcePath, "package-lock.json"))) {
          copyFileSync(
            join(this.typeScriptSourcePath, "package-lock.json"),
            join(this.path, "package-lock.json")
          );
        }
        // Install production only dependencies into deploy path
        execFileSync(
          "npm",
          [
            "install",
            "--loglevel",
            "error",
            "--only=prod",
            "--no-audit",
            "--no-bin-links",
            "--no-optional",
          ],
          {
            cwd: this.path,
          }
        );

        const time = new Date();
        try {
          utimesSync(stampFile, time, time);
        } catch (err) {
          closeSync(openSync(stampFile, "w"));
        }
        process.stdout.write(green("✔\n"));
      }
    } catch (e) {
      console.error(red(e.message));
    }
  }
}
