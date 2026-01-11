/**
 * BAC Calculator - Shared module for Blood Alcohol Content calculations
 * Uses Michaelis-Menten enzyme kinetics and Weibull absorption model
 */

// ============================================================================
// CONSTANTS - Named constants for clarity and maintainability
// ============================================================================

const CONSTANTS = {
    // Unit conversions
    LBS_TO_KG: 0.453592,
    OZ_TO_ML: 29.5735,
    ALCOHOL_DENSITY_G_PER_ML: 0.789,

    // Atomic weights for electrolyte calculations (mg per mmol)
    ATOMIC_WEIGHT_SODIUM: 23,      // Na atomic weight
    ATOMIC_WEIGHT_POTASSIUM: 39,   // K atomic weight

    // Widmark distribution ratios (volume of distribution)
    WIDMARK_RATIO: {
        male: 0.68,
        female: 0.55
    },

    // Michaelis-Menten parameters for elimination
    // Vmax: Maximum elimination rate (g/dL/hr)
    VMAX_BY_GENDER: {
        male: 0.017,    // g/dL/hr - males metabolize ~30% faster due to higher ADH enzyme levels
        female: 0.013   // g/dL/hr - females have ~25-30% less ADH enzyme
    },
    KM: 0.015,  // g/dL - Michaelis constant (enzyme saturation point)

    // Weibull shape parameter (constant across beverages)
    // This value creates the asymmetric absorption pattern observed in research
    WEIBULL_K: 2.8,

    // Scale parameter (λ) by beverage type - controls absorption speed
    // Smaller λ = faster absorption and earlier peak
    BEVERAGE_LAMBDA: {
        beer: 45,      // Slowest - low alcohol % + grain density
        wine: 35,      // Moderate - balanced 12-15% concentration
        seltzer: 30,   // Moderate-fast - 5% but carbonation speeds absorption
        spirits: 25    // Fastest - high alcohol % triggers rapid gastric emptying
    },

    // Gastric emptying delay (lag time) by stomach fullness
    // Time before alcohol starts moving from stomach to small intestine
    LAG_BY_FULLNESS: {
        empty: 12,     // 12 min - empty stomach
        moderate: 35,  // 35 min - some food/snacks
        full: 75       // 75 min - full meal (1.25 hours)
    },

    // Hydration constants
    FLUID_LOSS_RATIO: 1.15,  // ~115ml fluid lost per 10g ethanol (diuretic effect)
    ELECTROLYTE_LOSS_RATE: {
        sodium: 0.8,     // mmol per drink
        potassium: 0.6   // mmol per drink
    },

    // Hangover severity factors
    HANGOVER: {
        ALCOHOL_FACTOR_DIVISOR: 10,      // grams of alcohol per point
        DEHYDRATION_FACTOR_DIVISOR: 125, // ml fluid deficit per point
        CONSUMPTION_RATE_THRESHOLD: 2,   // drinks per hour considered "rapid"
        RAPID_CONSUMPTION_PENALTY: 1.5,  // additional severity for rapid drinking
        MAX_ALCOHOL_POINTS: 4,
        MAX_DEHYDRATION_POINTS: 4,
        MAX_RATE_POINTS: 2,
        MAX_SEVERITY: 10
    }
};

// Export constants for use in other modules
if (typeof window !== 'undefined') {
    window.BAC_CONSTANTS = CONSTANTS;
}

// ============================================================================
// BACCalculator Class - Core BAC calculation using Michaelis-Menten kinetics
// ============================================================================

class BACCalculator {
    constructor() {
        this.widmarkRatio = CONSTANTS.WIDMARK_RATIO;
        this.vmaxByGender = CONSTANTS.VMAX_BY_GENDER;
        this.km = CONSTANTS.KM;
        this.k = CONSTANTS.WEIBULL_K;
        this.beverageLambda = CONSTANTS.BEVERAGE_LAMBDA;
        this.lagByFullness = CONSTANTS.LAG_BY_FULLNESS;
    }

    /**
     * Calculate absorption factor using Weibull distribution with gastric lag
     * Accounts for beverage type and stomach fullness
     */
    getAbsorptionFactor(minutesSinceDrink, stomachFullness = 'empty', beverageType = 'wine') {
        const lag = this.lagByFullness[stomachFullness] || this.lagByFullness.empty;
        const lambda = this.beverageLambda[beverageType] || this.beverageLambda.wine;

        // Before lag time, no absorption
        if (minutesSinceDrink < lag) {
            return 0;
        }

        // Weibull CDF: F(t) = 1 - exp(-((t - lag)/λ)^k)
        const t = minutesSinceDrink - lag;
        const absorption = 1 - Math.exp(-Math.pow(t / lambda, this.k));

        return Math.min(absorption, 1.0);
    }

    /**
     * Calculate absorption RATE (derivative of Weibull CDF)
     * Returns rate of absorption per minute at time t
     */
    getAbsorptionRate(minutesSinceDrink, stomachFullness = 'empty', beverageType = 'wine') {
        const lag = this.lagByFullness[stomachFullness] || this.lagByFullness.empty;
        const lambda = this.beverageLambda[beverageType] || this.beverageLambda.wine;

        // Before lag time, no absorption
        if (minutesSinceDrink < lag) {
            return 0;
        }

        const t = minutesSinceDrink - lag;
        // Derivative of Weibull CDF: (k/λ) * (t/λ)^(k-1) * exp(-(t/λ)^k)
        const rate = (this.k / lambda) * Math.pow(t / lambda, this.k - 1) * Math.exp(-Math.pow(t / lambda, this.k));

        return rate;
    }

    /**
     * Calculate current BAC from all drinks using Michaelis-Menten kinetics
     * Integrates absorption and elimination simultaneously minute-by-minute
     * CRITICAL: Elimination must be applied to TOTAL BAC, not individual drinks
     */
    calculateCurrentBAC(drinks, profile) {
        if (!profile || !profile.weightLbs || !profile.gender) {
            return 0;
        }

        const currentTime = new Date();
        const weightKg = profile.weightLbs * CONSTANTS.LBS_TO_KG;
        const r = this.widmarkRatio[profile.gender];

        // Michaelis-Menten parameters (gender-specific)
        const Vmax = this.vmaxByGender[profile.gender];
        const Km = this.km;

        // Find the earliest drink time to determine integration range
        let earliestTime = currentTime;
        drinks.forEach(drink => {
            const drinkTime = new Date(drink.timestamp);
            if (drinkTime < earliestTime && drinkTime <= currentTime) {
                earliestTime = drinkTime;
            }
        });

        const totalMinutes = Math.ceil((currentTime - earliestTime) / (1000 * 60));
        if (totalMinutes <= 0) return 0;

        // Integrate all drinks together with elimination applied to combined BAC
        let totalBAC = 0;

        for (let minute = 0; minute <= totalMinutes; minute += 1) {
            const currentSimTime = new Date(earliestTime.getTime() + minute * 60 * 1000);

            // Calculate absorption from ALL drinks at this minute
            let totalAbsorption = 0;

            drinks.forEach(drink => {
                const drinkTime = new Date(drink.timestamp);
                const minutesSinceDrink = (currentSimTime - drinkTime) / (1000 * 60);

                if (minutesSinceDrink < 0) return; // Drink hasn't happened yet

                const stomachFullness = drink.stomachFullness || 'empty';
                const beverageType = drink.beverageType || 'wine';

                // Get absorption rate for this drink at this time
                const absorptionRate = this.getAbsorptionRate(minutesSinceDrink, stomachFullness, beverageType);
                const gramsAbsorbedThisMinute = drink.gramsAlcohol * absorptionRate;
                const bacIncrease = gramsAbsorbedThisMinute / (weightKg * r * 10);

                totalAbsorption += bacIncrease;
            });

            // Add absorption from all drinks
            totalBAC += totalAbsorption;

            // Apply Michaelis-Menten elimination to TOTAL BAC
            if (totalBAC > 0) {
                const eliminationRate = (Vmax * totalBAC) / (Km + totalBAC);
                const bacDecrease = eliminationRate * (1/60);
                totalBAC = Math.max(0, totalBAC - bacDecrease);
            }
        }

        return Math.max(0, totalBAC);
    }

    /**
     * Project BAC over the next N hours using Michaelis-Menten kinetics
     */
    projectBAC(drinks, profile, hours = 8) {
        if (!profile || !profile.weightLbs || !profile.gender) {
            return Array(hours * 60 + 1).fill(0);
        }

        const currentTime = new Date();
        const projectionEnd = new Date(currentTime.getTime() + hours * 60 * 60 * 1000);
        const weightKg = profile.weightLbs * CONSTANTS.LBS_TO_KG;
        const r = this.widmarkRatio[profile.gender];

        const Vmax = this.vmaxByGender[profile.gender];
        const Km = this.km;

        // Find the earliest drink time
        let earliestTime = currentTime;
        drinks.forEach(drink => {
            const drinkTime = new Date(drink.timestamp);
            if (drinkTime < earliestTime) {
                earliestTime = drinkTime;
            }
        });

        // Integrate from earliest drink to projection end
        const totalMinutes = Math.ceil((projectionEnd - earliestTime) / (1000 * 60));
        const minutesFromNow = Math.ceil((currentTime - earliestTime) / (1000 * 60));

        let totalBAC = 0;
        const projection = [];

        for (let minute = 0; minute <= totalMinutes; minute += 1) {
            const currentSimTime = new Date(earliestTime.getTime() + minute * 60 * 1000);

            let totalAbsorption = 0;

            drinks.forEach(drink => {
                const drinkTime = new Date(drink.timestamp);
                const minutesSinceDrink = (currentSimTime - drinkTime) / (1000 * 60);

                if (minutesSinceDrink < 0) return;

                const stomachFullness = drink.stomachFullness || 'empty';
                const beverageType = drink.beverageType || 'wine';

                const absorptionRate = this.getAbsorptionRate(minutesSinceDrink, stomachFullness, beverageType);
                const gramsAbsorbedThisMinute = drink.gramsAlcohol * absorptionRate;
                const bacIncrease = gramsAbsorbedThisMinute / (weightKg * r * 10);

                totalAbsorption += bacIncrease;
            });

            totalBAC += totalAbsorption;

            if (totalBAC > 0) {
                const eliminationRate = (Vmax * totalBAC) / (Km + totalBAC);
                const bacDecrease = eliminationRate * (1/60);
                totalBAC = Math.max(0, totalBAC - bacDecrease);
            }

            // Store projection data point if this minute is >= currentTime
            if (minute >= minutesFromNow) {
                projection.push(totalBAC);
            }
        }

        // Ensure we have exactly hours*60+1 data points
        while (projection.length < hours * 60 + 1) {
            projection.push(0);
        }

        return projection.slice(0, hours * 60 + 1);
    }

    /**
     * Find peak BAC from projection
     */
    getPeakBAC(drinks, profile, hours = 8) {
        const projection = this.projectBAC(drinks, profile, hours);
        return Math.max(...projection);
    }

    /**
     * Calculate grams of alcohol from volume and ABV
     */
    static calculateGramsAlcohol(volumeOz, abv) {
        const volumeMl = volumeOz * CONSTANTS.OZ_TO_ML;
        return volumeMl * (abv / 100) * CONSTANTS.ALCOHOL_DENSITY_G_PER_ML;
    }
}

// ============================================================================
// HydrationCalculator Class - Models diuretic effects and hydration
// ============================================================================

class HydrationCalculator {
    constructor() {
        this.fluidLossRatio = CONSTANTS.FLUID_LOSS_RATIO;
        this.electrolyteLossRate = CONSTANTS.ELECTROLYTE_LOSS_RATE;
    }

    /**
     * Calculate total fluid loss from alcohol's diuretic effect
     */
    calculateFluidLoss(drinks) {
        let totalFluidLoss = 0;
        drinks.forEach(drink => {
            const alcoholGrams = drink.gramsAlcohol;
            const fluidLossMl = alcoholGrams * this.fluidLossRatio;
            totalFluidLoss += fluidLossMl;
        });
        return totalFluidLoss;
    }

    /**
     * Calculate electrolyte loss from drinking
     * Returns values in milligrams
     */
    calculateElectrolyteLoss(drinks) {
        const totalDrinks = drinks.length;
        return {
            // Convert mmol to mg using atomic weights
            sodium: totalDrinks * this.electrolyteLossRate.sodium * CONSTANTS.ATOMIC_WEIGHT_SODIUM,
            potassium: totalDrinks * this.electrolyteLossRate.potassium * CONSTANTS.ATOMIC_WEIGHT_POTASSIUM
        };
    }

    /**
     * Calculate predicted hangover severity (0-10 scale)
     * Factors considered:
     * - Total alcohol consumed
     * - Dehydration level (fluid deficit)
     * - Rate of consumption (drinks per hour)
     */
    calculateHangoverSeverity(drinks, waterIntake, profile) {
        if (!profile || !profile.weightLbs || !profile.gender) return 0;
        if (drinks.length === 0) return 0;

        const H = CONSTANTS.HANGOVER;

        // Factor 1: Total alcohol consumed (0-4 points)
        const totalAlcohol = drinks.reduce((sum, d) => sum + d.gramsAlcohol, 0);
        const alcoholPoints = Math.min(H.MAX_ALCOHOL_POINTS, totalAlcohol / H.ALCOHOL_FACTOR_DIVISOR);

        // Factor 2: Dehydration (0-4 points)
        const fluidLoss = this.calculateFluidLoss(drinks);
        const fluidDeficit = Math.max(0, fluidLoss - waterIntake);
        const dehydrationPoints = Math.min(H.MAX_DEHYDRATION_POINTS, fluidDeficit / H.DEHYDRATION_FACTOR_DIVISOR);

        // Factor 3: Consumption rate (0-2 points)
        // Rapid drinking causes worse hangovers due to acetaldehyde buildup
        let ratePoints = 0;
        if (drinks.length >= 2) {
            const timestamps = drinks.map(d => new Date(d.timestamp).getTime()).sort((a, b) => a - b);
            const drinkingDurationHours = (timestamps[timestamps.length - 1] - timestamps[0]) / (1000 * 60 * 60);
            if (drinkingDurationHours > 0) {
                const drinksPerHour = drinks.length / drinkingDurationHours;
                if (drinksPerHour >= H.CONSUMPTION_RATE_THRESHOLD) {
                    ratePoints = Math.min(H.MAX_RATE_POINTS, (drinksPerHour - H.CONSUMPTION_RATE_THRESHOLD) * H.RAPID_CONSUMPTION_PENALTY);
                }
            }
        }

        // Calculate total severity
        const severity = alcoholPoints + dehydrationPoints + ratePoints;
        return Math.min(H.MAX_SEVERITY, Math.round(severity * 10) / 10);
    }

    /**
     * Get rehydration recommendations based on current deficit
     */
    getRehydrationRecommendations(fluidDeficit, electrolytes) {
        if (fluidDeficit <= 0 && electrolytes.sodium < 100 && electrolytes.potassium < 100) {
            return '✓ Fully hydrated! No action needed.';
        }

        let recommendations = [];
        if (fluidDeficit > 0) {
            const hours = Math.ceil(fluidDeficit / 500);
            recommendations.push(`• Drink ${Math.round(fluidDeficit)}ml water over next ${hours} hour${hours > 1 ? 's' : ''}`);
        }
        if (electrolytes.sodium > 200 || electrolytes.potassium > 300) {
            recommendations.push(`• Consider sports drink or coconut water for electrolytes`);
        }
        return recommendations.join('<br>');
    }
}

// ============================================================================
// ImpairmentDataModel Class - Maps BAC levels to impairment percentages
// ============================================================================

class ImpairmentDataModel {
    constructor() {
        // Research-backed impairment mappings (0-100 scale)
        this.data = {
            cognitive: {
                0.00: 0,
                0.02: 10,
                0.05: 30,
                0.08: 50,
                0.10: 65,
                0.15: 80,
                0.20: 95
            },
            motor: {
                0.00: 0,
                0.02: 15,
                0.05: 35,
                0.08: 55,
                0.10: 70,
                0.15: 85,
                0.20: 95
            },
            visual: {
                0.00: 0,
                0.02: 12,
                0.05: 28,
                0.08: 48,
                0.10: 62,
                0.15: 78,
                0.20: 92
            }
        };
    }

    /**
     * Get impairment percentage for a given category and BAC
     * Uses linear interpolation between data points
     */
    getImpairment(category, bac) {
        const thresholds = this.data[category];
        const keys = Object.keys(thresholds).map(parseFloat).sort((a, b) => a - b);

        if (bac <= keys[0]) return thresholds[keys[0]];
        if (bac >= keys[keys.length - 1]) return thresholds[keys[keys.length - 1]];

        for (let i = 0; i < keys.length - 1; i++) {
            if (bac >= keys[i] && bac <= keys[i + 1]) {
                const t = (bac - keys[i]) / (keys[i + 1] - keys[i]);
                return thresholds[keys[i]] + t * (thresholds[keys[i + 1]] - thresholds[keys[i]]);
            }
        }

        return 0;
    }

    /**
     * Get legal status based on BAC level
     */
    getLegalStatus(bac) {
        if (bac < 0.02) return { status: 'Legal (Safe)', color: '#14b8a6', percent: 0 };
        if (bac < 0.05) return { status: 'Caution', color: '#f59e0b', percent: 25 };
        if (bac < 0.08) return { status: 'Impaired (Unsafe)', color: '#f59e0b', percent: 50 };
        if (bac < 0.15) return { status: 'Illegal to Drive', color: '#ef4444', percent: 75 };
        return { status: 'Dangerous', color: '#ef4444', percent: 100 };
    }
}

// Export classes for browser usage
if (typeof window !== 'undefined') {
    window.BACCalculator = BACCalculator;
    window.HydrationCalculator = HydrationCalculator;
    window.ImpairmentDataModel = ImpairmentDataModel;
}

// Export for ES modules (if supported)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { BACCalculator, HydrationCalculator, ImpairmentDataModel, CONSTANTS };
}
