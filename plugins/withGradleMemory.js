/**
 * 2026-08-30 — Raise the Gradle JVM ceiling, because the committed one is no longer enough.
 *
 * THE EVIDENCE, not a guess. Two EAS Android builds failed with nothing but
 * "Gradle build failed with unknown error", and the EAS log encoding defeated every attempt to read
 * it. So the toolchain went on this machine instead, and the FIRST local build — using the committed
 * settings exactly as EAS does — failed with:
 *
 *     e: [ksp] java.lang.OutOfMemoryError: Metaspace
 *     Execution failed for task ':expo-updates:kspReleaseKotlin'
 *     Execution failed for task ':expo-modules-core:lintVitalAnalyzeRelease'
 *
 * The generated gradle.properties carries `-Xmx2048m -XX:MaxMetaspaceSize=512m`. Overriding to a
 * larger metaspace on the command line made the same source compile cleanly and produce an APK. EAS
 * gets the committed value, so it is hitting the same ceiling — and an OOM inside a KSP worker is
 * exactly the kind of failure that surfaces as "unknown error" rather than a named one.
 *
 * WHY IT STARTED NOW. The last successful Android build was 2026-08-14, about 200 commits ago.
 * react-native-purchases has been added since, along with everything else in that window. KSP and
 * lint metaspace usage scales with the number of modules processed; 512 MB stopped being enough
 * somewhere in there. Nothing about the Kotlin is wrong — the AudioDeviceCallback bug was real and
 * is fixed, and the build compiles locally with it.
 *
 * 2 GB metaspace against a 4 GB heap: metaspace was the thing that actually blew, and EAS Android
 * workers have well beyond this available. Deliberately not raised further — a number chosen to
 * clear the observed failure, not the largest one that fits.
 *
 * A CAVEAT WORTH KEEPING: this is a strongly evidenced hypothesis, not a confirmed read of the EAS
 * log. If the next build still fails, the local reproduction says it is NOT the Kotlin and NOT
 * memory, and the next step is getting a human to read the "Run gradlew" phase.
 */

const { withGradleProperties } = require('@expo/config-plugins');

const KEY = 'org.gradle.jvmargs';
const VALUE = '-Xmx4096m -XX:MaxMetaspaceSize=2048m -XX:+HeapDumpOnOutOfMemoryError -Dfile.encoding=UTF-8';

function withGradleMemory(config) {
  return withGradleProperties(config, (cfg) => {
    // Replace rather than append: a duplicate key in gradle.properties is resolved last-wins, which
    // works by accident and reads as a mistake. There should be exactly one.
    cfg.modResults = cfg.modResults.filter(
      (item) => !(item.type === 'property' && item.key === KEY),
    );
    cfg.modResults.push({ type: 'property', key: KEY, value: VALUE });
    console.log(`[withGradleMemory] ${KEY} = ${VALUE}`);
    return cfg;
  });
}

module.exports = withGradleMemory;
