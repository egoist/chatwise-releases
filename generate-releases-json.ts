import * as YAML from "yaml";

interface Config {
  s3Bucket: string;
  r2AccountId: string;
  awsAccessKeyId: string;
  awsSecretAccessKey: string;
  version: string;
  bucketOrigin: string;
}

interface ReleaseAsset {
  name: string;
  url: string;
  sha512?: string;
}

interface Release {
  version: string;
  changelog: string;
  assets: ReleaseAsset[];
  date: string;
}

interface ManifestFile {
  url: string;
  sha512?: string;
}

interface Manifest {
  releaseNotes?: string;
  releaseDate?: string;
  files?: ManifestFile[];
}

const UPDATE_MANIFESTS = new Set([
  "latest-mac.yml",
  "latest.yml",
  "latest-linux.yml",
]);

const config: Config = {
  s3Bucket: process.env.S3_BUCKET || "chatwise-releases2",
  r2AccountId: process.env.R2_ACCOUNT_ID!,
  awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID!,
  awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  version: process.env.VERSION!,
  bucketOrigin: process.env.BUCKET_ORIGIN || "https://releases.chatwise.app",
};

const s3Client = new Bun.S3Client({
  bucket: config.s3Bucket,
  endpoint: `https://${config.r2AccountId}.r2.cloudflarestorage.com`,
  accessKeyId: config.awsAccessKeyId,
  secretAccessKey: config.awsSecretAccessKey,
});

async function getS3Text(key: string): Promise<string | null> {
  try {
    return await s3Client.file(key).text();
  } catch {
    return null;
  }
}

async function generateReleasesJson(): Promise<void> {
  const { version, bucketOrigin } = config;

  if (!version) throw new Error("VERSION environment variable is required");

  console.log(`Generating release.json for version ${version}...`);

  const [macText, winText, linuxText] = await Promise.all([
    getS3Text(`${version}/latest-mac.yml`),
    getS3Text(`${version}/latest.yml`),
    getS3Text(`${version}/latest-linux.yml`),
  ]);

  const assets: ReleaseAsset[] = [];
  let changelog = "";
  let date = "";

  for (const text of [macText, winText, linuxText]) {
    if (!text) continue;
    try {
      const manifest = YAML.parse(text) as Manifest;
      if (text === macText) {
        changelog = manifest.releaseNotes || "";
        date = manifest.releaseDate || "";
      }
      for (const file of manifest.files ?? []) {
        if (!file.url) continue;
        const name = file.url;
        if (UPDATE_MANIFESTS.has(name)) continue;
        // avoid duplicates (e.g. universal mac listed in multiple manifests)
        if (assets.some((a) => a.name === name)) continue;
        assets.push({
          name,
          url: `${bucketOrigin}/${version}/${name}`,
          ...(file.sha512 ? { sha512: file.sha512 } : {}),
        });
      }
    } catch {
      // Ignore YAML parse errors
    }
  }

  const release: Release = { version, changelog, assets, date };
  const key = `${version}/release.json`;

  console.log(`Uploading to s3: ${key}...`);
  await s3Client.write(key, JSON.stringify(release), {
    type: "application/json",
  });
  console.log(`Done.`);
}

if (import.meta.main) {
  generateReleasesJson().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
