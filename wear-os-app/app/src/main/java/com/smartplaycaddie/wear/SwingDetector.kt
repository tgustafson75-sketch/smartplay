/**
 * 2026-06-29 — Wrist-IMU swing detector (Wear OS, runs ON the watch).
 *
 * Pure-ish state machine that ingests timestamped accelerometer +
 * gyroscope samples and emits ONE Swing summary when a full golf swing
 * is detected. No allocation in the hot path beyond the ring buffer.
 *
 * HONESTY NOTE — what is measured vs. derived:
 *   MEASURED directly by the wrist IMU:
 *     - backswingMs / downswingMs / tempoRatio  (timing of the gyro
 *       reversal at the top + the impact accel spike — high confidence)
 *     - peakWristSpeed (peak gyro magnitude, rad/s, during downswing)
 *     - wristAcceleration / impactAcceleration (m/s²)
 *   DERIVED (estimate, documented):
 *     - clubHeadSpeedEst = peakWristAngularVel (rad/s) × CLUB_RADIUS_M.
 *       Single-pendulum approximation. The radius constant is a
 *       calibratable assumption, not a launch-monitor reading. Phone
 *       brands this as the 'watch' source tier (truth-grade relative to
 *       pose), but the methodology is an estimate — do not present it as
 *       radar-measured club speed.
 *
 * Sensor frames (Android conventions):
 *   - gyroscope  : rad/s, body axes (we use the magnitude, axis-agnostic)
 *   - accelerometer : m/s², INCLUDES gravity (~9.81 at rest). We subtract
 *     a nominal gravity to get the dynamic-motion magnitude.
 */

package com.smartplaycaddie.wear

import kotlin.math.sqrt

/** One IMU sample (gyro magnitude + linear accel magnitude) at a time. */
private data class Sample(
    val tMs: Long,
    val gyroMag: Double,   // rad/s
    val accelMag: Double,  // m/s², gravity-removed (nominal)
)

/** Completed-swing summary. Mirrors the phone's watchStore SwingMetrics
 *  shape so the JS bridge is a 1:1 map (minus the auto-stamped timestamp). */
data class Swing(
    val backswingMs: Int,
    val downswingMs: Int,
    val tempoRatio: Double,
    val peakWristSpeed: Double,      // rad/s (peak gyro magnitude in downswing)
    val wristAcceleration: Double,   // m/s² (peak dynamic accel in downswing)
    val impactAcceleration: Double,  // m/s² (accel at the detected impact)
    val transitionDetected: Boolean,
    val earlyTransition: Boolean,
    val tempoGood: Boolean,
    val clubHeadSpeedEstMph: Double, // derived estimate (see file header)
)

class SwingDetector(
    /** Effective hub→clubhead radius for the club-speed estimate.
     *  ~1.6 m is a driver-length default; calibratable per club later. */
    private val clubRadiusM: Double = 1.6,
    private val onSwing: (Swing) -> Unit,
) {
    private enum class State { IDLE, BACKSWING, DOWNSWING, FOLLOWTHROUGH }

    // ─── Tunable thresholds (rad/s, m/s², ms) ──────────────────────────
    private val takeawayStart = 1.5   // gyro mag that arms a swing
    private val topLull = 0.9         // gyro mag dip that marks top-of-backswing
    private val impactAccel = 80.0    // dynamic-accel spike that marks impact
    private val settleGyro = 1.0      // gyro mag below this = motion settled
    private val settleMs = 250L       // sustained-settle window to finalize
    private val maxSwingMs = 4000L    // abort guard — reset if no impact by here
    private val minBackswingMs = 150L // reject twitches shorter than a real backswing
    private val gravity = 9.81

    private var state = State.IDLE
    private var tStart = 0L
    private var tTop = 0L
    private var tImpact = 0L
    private var peakGyroDown = 0.0
    private var peakAccelDown = 0.0
    private var impactAccelVal = 0.0
    private var topGyroMin = Double.MAX_VALUE
    private var settleStart = 0L

    // Latest raw vectors, merged on each gyro tick (sensors arrive separately).
    @Volatile private var ax = 0.0
    @Volatile private var ay = 0.0
    @Volatile private var az = 0.0

    /** Feed an accelerometer sample (m/s², raw incl. gravity). */
    fun onAccel(x: Float, y: Float, z: Float) {
        ax = x.toDouble(); ay = y.toDouble(); az = z.toDouble()
    }

    /** Feed a gyroscope sample (rad/s). Drives the state machine. */
    fun onGyro(x: Float, y: Float, z: Float, tMs: Long) {
        val gyroMag = sqrt(x * x + y * y + z * z.toDouble())
        val accelRaw = sqrt(ax * ax + ay * ay + az * az)
        val accelMag = kotlin.math.abs(accelRaw - gravity)
        step(Sample(tMs, gyroMag, accelMag))
    }

    private fun step(s: Sample) {
        when (state) {
            State.IDLE -> {
                if (s.gyroMag >= takeawayStart) {
                    state = State.BACKSWING
                    tStart = s.tMs
                    tTop = 0L; tImpact = 0L
                    peakGyroDown = 0.0; peakAccelDown = 0.0
                    impactAccelVal = 0.0; topGyroMin = Double.MAX_VALUE
                }
            }

            State.BACKSWING -> {
                if (tooLong(s.tMs)) { reset(); return }
                // Top-of-backswing = the gyro magnitude dips into a lull
                // (direction reversal) after a real backswing has elapsed.
                if (s.tMs - tStart >= minBackswingMs && s.gyroMag <= topLull) {
                    tTop = s.tMs
                    topGyroMin = s.gyroMag
                    state = State.DOWNSWING
                }
            }

            State.DOWNSWING -> {
                if (tooLong(s.tMs)) { reset(); return }
                if (s.gyroMag > peakGyroDown) peakGyroDown = s.gyroMag
                if (s.accelMag > peakAccelDown) peakAccelDown = s.accelMag
                // Impact = sharp accel spike. Capture its time + magnitude.
                if (s.accelMag >= impactAccel && tImpact == 0L) {
                    tImpact = s.tMs
                    impactAccelVal = s.accelMag
                    state = State.FOLLOWTHROUGH
                    settleStart = 0L
                }
            }

            State.FOLLOWTHROUGH -> {
                if (tooLong(s.tMs)) { reset(); return }
                if (s.accelMag > impactAccelVal) impactAccelVal = s.accelMag
                if (s.gyroMag <= settleGyro) {
                    if (settleStart == 0L) settleStart = s.tMs
                    if (s.tMs - settleStart >= settleMs) {
                        finalize()
                        reset()
                    }
                } else {
                    settleStart = 0L
                }
            }
        }
    }

    private fun tooLong(now: Long) = tStart != 0L && now - tStart > maxSwingMs

    private fun finalize() {
        if (tTop <= tStart || tImpact <= tTop) return // incomplete; drop quietly
        val backswingMs = (tTop - tStart).toInt()
        val downswingMs = (tImpact - tTop).toInt()
        if (downswingMs <= 0) return
        val tempoRatio = backswingMs.toDouble() / downswingMs.toDouble()
        // Derived club-head speed (single-pendulum estimate — see header).
        val clubMps = peakGyroDown * clubRadiusM
        val clubMph = clubMps * 2.2369362921
        // earlyTransition heuristic: the player started down without the
        // gyro settling near zero at the top (a "rushed"/cast transition).
        val earlyTransition = topGyroMin > topLull * 0.8
        val tempoGood = tempoRatio in 2.5..3.5

        onSwing(
            Swing(
                backswingMs = backswingMs,
                downswingMs = downswingMs,
                tempoRatio = round2(tempoRatio),
                peakWristSpeed = round2(peakGyroDown),
                wristAcceleration = round2(peakAccelDown),
                impactAcceleration = round2(impactAccelVal),
                transitionDetected = true,
                earlyTransition = earlyTransition,
                tempoGood = tempoGood,
                clubHeadSpeedEstMph = round2(clubMph),
            )
        )
    }

    private fun reset() {
        state = State.IDLE
        tStart = 0L; tTop = 0L; tImpact = 0L
        peakGyroDown = 0.0; peakAccelDown = 0.0
        impactAccelVal = 0.0; topGyroMin = Double.MAX_VALUE
        settleStart = 0L
    }

    private fun round2(v: Double) = Math.round(v * 100.0) / 100.0
}
