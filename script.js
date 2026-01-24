document.addEventListener('DOMContentLoaded', () => {

    // --- Mortgage Engine ---
    class MortgageEngine {
        constructor() {
            this.P = 0;
            this.fees = 0;
            this.r = 0;
            this.termMonths = 300;
            this.freq = 'monthly';
            this.offset = 0;
            this.redraw = 0;
            this.loanStartDate = null;
            this.repaymentStartDate = null;
            this.isFixed = false;
            this.fixedRate = 0;
            this.fixedDurationYears = 0;
            this.fixedStartDate = null;
            this.isSplit = false;
            this.splitType = 'percent'; // 'percent' or 'value'
            this.splitPercent = 50;
            this.splitValue = 0;
            this.splitRate = 0;
            this.splitDurationYears = 0;
            this.splitStartDate = null;
            this.isInterestOnly = false;
            this.ioRate = 0;
            this.ioDurationYears = 0;
            this.ioStartDate = null;
            this.repaymentOverride = null;
            this.interventions = [];

            this.history = [];
            this.periodicRepayment = 0;
            this.totalInterest = 0;
            this.baselineInterest = 0;
            this.monthsSaved = 0;
            this.neutralityDate = null;
            this.loanEndDate = null;

            this.propertyValue = 0;
            this.growthRate = 0;
            this.propertyHistory = [];
            this.propertyHistory = [];
            this.milestones = {};

            // Refinance Properties
            this.isRefinance = false;
            this.refinanceDate = null;
            this.refinanceAmount = 0;
            this.refinanceTermMonths = 360;
            this.refinanceRate = 0;
            this.refinanceType = 'variable';
            this.refinanceFixedYears = 0;
            this.refinanceIOYears = 0;
            this.refinanceFixedEnd = null;
            this.refinanceIOEnd = null;
            this.comparisonHistory = []; // History without refinance for comparison
        }

        getPeriodsPerYear() {
            const f = (this.freq || 'monthly').toLowerCase();
            if (f === 'weekly') return 52;
            if (f === 'fortnightly') return 26;
            return 12;
        }

        getDaysPerPeriod() {
            const f = (this.freq || 'monthly').toLowerCase();
            if (f === 'weekly') return 7;
            if (f === 'fortnightly') return 14;
            return 30.4375; // Average days in month
        }

        calculate() {
            // Loan starts at exact Loan Amount
            const totalPrincipal = this.P; // Anniversary fees added during simulation
            if (totalPrincipal <= 0 || this.termMonths <= 0) return;

            this.refinanceIndex = -1;
            this.milestones = {};

            const loanStart = this.loanStartDate || new Date();
            const repayStart = this.repaymentStartDate || loanStart;

            // Determine starting rate for the first repayment
            let startRate = this.r;
            if (this.isInterestOnly && this.ioStartDate && this.ioDurationYears > 0) {
                const ioEnd = new Date(this.ioStartDate);
                ioEnd.setFullYear(ioEnd.getFullYear() + this.ioDurationYears);
                if (repayStart >= this.ioStartDate && repayStart < ioEnd) {
                    startRate = this.ioRate;
                }
            } else if (this.isFixed && this.fixedStartDate && this.fixedDurationYears > 0) {
                const fixedEnd = new Date(this.fixedStartDate);
                fixedEnd.setFullYear(fixedEnd.getFullYear() + this.fixedDurationYears);
                if (repayStart >= this.fixedStartDate && repayStart < fixedEnd) {
                    startRate = this.fixedRate;
                }
            }

            const ppy = this.getPeriodsPerYear();
            const contractPeriods = Math.ceil((this.termMonths / 12) * ppy);

            // Initial Periodic Repayment
            if (this.isInterestOnly && this.ioStartDate && this.ioStartDate <= repayStart) {
                // If starting in IO, periodic repayment is just interest
                this.periodicRepayment = Math.round((totalPrincipal * (startRate / 100) / ppy) * 100) / 100;
            } else {
                this.periodicRepayment = Math.round(this.calculateRepayment(totalPrincipal, startRate, contractPeriods, ppy) * 100) / 100;
            }

            // Split loan repayments
            this.splitFixedRepayment = 0;
            this.splitVariableRepayment = 0;
            this.splitTotalRepayment = 0;

            // Calculate split loan repayments if applicable BEFORE simulation
            if (this.isSplit && this.splitDurationYears > 0) {
                const totalPeriods = Math.ceil((this.termMonths / 12) * ppy);

                // Calculate fixed portion amount
                let fixedAmount = 0;
                if (this.splitType === 'percent') {
                    fixedAmount = this.P * (this.splitPercent / 100);
                } else {
                    fixedAmount = this.splitValue;
                }
                const variableAmount = this.P - fixedAmount;

                // Calculate separate repayments based on total loan term
                this.splitFixedRepayment = Math.round(this.calculateRepayment(fixedAmount, this.splitRate, totalPeriods, ppy) * 100) / 100;
                this.splitVariableRepayment = Math.round(this.calculateRepayment(variableAmount, this.r, totalPeriods, ppy) * 100) / 100;
                this.splitTotalRepayment = this.splitFixedRepayment + this.splitVariableRepayment;
            }

            const actualRepayment = this.repaymentOverride || (this.isSplit && this.splitStartDate && this.splitStartDate <= loanStart ? this.splitTotalRepayment : this.periodicRepayment);

            // --- BASELINE (no offset/interventions/fees) ---
            // Note: Baseline currently doesn't account for refinance to keep comparison simple, 
            // or we could assume refinance happens in baseline too? 
            // For now, let's keep baseline as "Original Loan Path" without refinance for comparison.
            this.baselineInterest = this.runSimulation(totalPrincipal, this.r, actualRepayment, 0, 0, 0, []).totalInterest;

            // --- COMPARISON Simulation (Projected path WITHOUT refinance) ---
            const wasRefinance = this.isRefinance;
            this.isRefinance = false;
            // Run simulation with current settings but NO refinance
            this.comparisonHistory = this.runSimulation(totalPrincipal, this.r, actualRepayment, this.offset, this.redraw, this.fees, this.interventions).history;
            this.isRefinance = wasRefinance; // Restore state

            // --- ACTUAL Simulation ---
            const result = this.runSimulation(totalPrincipal, this.r, actualRepayment, this.offset, this.redraw, this.fees, this.interventions);
            this.history = result.history;
            this.totalInterest = result.totalInterest;
            this.neutralityDate = result.neutralityDate;
            this.loanEndDate = result.loanEndDate;
            this.propertyHistory = result.propertyHistory;
            this.milestones = result.milestones;
            this.fixedRateEnd = result.fixedRateEnd;
            this.splitRateEnd = result.splitRateEnd;
            this.ioRateEnd = result.ioRateEnd;
            this.neutralityIndex = result.neutralityIndex;

            const standardEndMonths = this.termMonths;
            const actualEndMonths = this.history.length > 0 ? monthsBetween(this.loanStartDate || new Date(), result.loanEndDate) : standardEndMonths;
            this.monthsSaved = Math.max(0, standardEndMonths - actualEndMonths);
        }

        calculateRepayment(principal, annualRate, periodsRemaining, ppy) {
            if (principal <= 0 || periodsRemaining <= 0) return 0;
            const periodRate = (annualRate / 100) / ppy;
            if (periodRate === 0) return principal / periodsRemaining;
            return principal * (periodRate * Math.pow(1 + periodRate, periodsRemaining)) / (Math.pow(1 + periodRate, periodsRemaining) - 1);
        }

        runSimulation(principal, rate, periodicContrib, initialOffset, initialRedraw, annualFee, interventions) {
            let currentBalance = principal;
            let currentOffset = initialOffset;
            let currentRedraw = initialRedraw;
            let currentRate = rate;
            let currentPeriodicContrib = periodicContrib;

            const history = [];
            const propertyHistory = [];
            let totalInterest = 0;
            let neutralityDate = null;
            let loanEndDate = null;

            // Property Growth Calculation
            let currentPropertyVal = this.propertyValue;
            const monthlyGrowthRate = this.growthRate / 100 / 12;
            const milestones = { lvr90: null, lvr80: null, lvr50: null, lvr25: null };

            const ppy = this.getPeriodsPerYear();
            const daysPerPeriod = this.getDaysPerPeriod();
            let totalSimulationPeriods = Math.round(ppy * 60); // Max 60 years
            let contractPeriods = Math.ceil((this.termMonths / 12) * ppy);

            const loanStart = this.loanStartDate || new Date();
            const repayStart = this.repaymentStartDate || loanStart;

            let lastFeeYear = loanStart.getFullYear();
            let previousIsFixedTerm = false;
            let previousIsSplitTerm = false;
            let previousIsIOTerm = false;

            // Calculate Fixed End Date
            let fixedEnd = null;
            if (this.isFixed && this.fixedStartDate && this.fixedDurationYears > 0) {
                fixedEnd = new Date(this.fixedStartDate);
                fixedEnd.setFullYear(fixedEnd.getFullYear() + this.fixedDurationYears);
            }

            // Calculate Split End Date
            let splitEnd = null;
            let splitAmount = 0;
            if (this.isSplit && this.splitStartDate && this.splitDurationYears > 0) {
                splitEnd = new Date(this.splitStartDate);
                splitEnd.setFullYear(splitEnd.getFullYear() + this.splitDurationYears);
                splitAmount = (this.splitType === 'percent') ? (this.P * this.splitPercent / 100) : this.splitValue;
            }

            // Calculate Interest Only End Date
            let ioEnd = null;
            if (this.isInterestOnly && this.ioStartDate && this.ioDurationYears > 0) {
                ioEnd = new Date(this.ioStartDate);
                ioEnd.setFullYear(ioEnd.getFullYear() + this.ioDurationYears);
            }

            for (let p = 1; p <= totalSimulationPeriods; p++) {
                const currentDate = new Date(repayStart);
                if (this.freq === 'monthly') {
                    currentDate.setMonth(currentDate.getMonth() + (p - 1));
                } else {
                    currentDate.setDate(currentDate.getDate() + (p - 1) * daysPerPeriod);
                }

                // Rates
                let effectiveRate = currentRate;
                let isInsideFixedTerm = false;
                let isInsideSplitTerm = false;
                let isInsideIOTerm = false;

                if (ioEnd && currentDate >= this.ioStartDate && currentDate < ioEnd) {
                    isInsideIOTerm = true;
                    effectiveRate = this.ioRate;
                }
                else if (splitEnd && currentDate >= this.splitStartDate && currentDate < splitEnd) isInsideSplitTerm = true;
                if (fixedEnd && currentDate >= this.fixedStartDate && currentDate < fixedEnd) {
                    isInsideFixedTerm = true;
                    effectiveRate = this.fixedRate;
                }

                let balanceNotes = [];
                let offsetNotes = [];
                let redrawNotes = [];

                // Detect Transitions
                if (p > 1 && isInsideFixedTerm !== previousIsFixedTerm) {
                    const remainingPeriods = contractPeriods - p + 1;
                    if (remainingPeriods > 0 && !this.repaymentOverride) {
                        currentPeriodicContrib = Math.round(this.calculateRepayment(currentBalance, effectiveRate, remainingPeriods, ppy) * 100) / 100;
                        balanceNotes.push(isInsideFixedTerm ? "Fixed Started" : "Reverted to Variable");
                    }
                }
                previousIsFixedTerm = isInsideFixedTerm;

                if (p > 1 && isInsideIOTerm !== previousIsIOTerm) {
                    const remainingPeriods = contractPeriods - p + 1;
                    if (remainingPeriods > 0 && !this.repaymentOverride) {
                        if (isInsideIOTerm) {
                            balanceNotes.push("Interest Only Started");
                        } else {
                            // Revert to variable (P+I)
                            currentPeriodicContrib = Math.round(this.calculateRepayment(currentBalance, currentRate, remainingPeriods, ppy) * 100) / 100;
                            balanceNotes.push("Interest Only Ended");
                        }
                    }
                }
                previousIsIOTerm = isInsideIOTerm;

                if (p > 1 && isInsideSplitTerm !== previousIsSplitTerm) {
                    const remainingPeriods = contractPeriods - p + 1;
                    if (remainingPeriods > 0 && !this.repaymentOverride) {
                        if (isInsideSplitTerm && !isInsideFixedTerm) {
                            const ratio = currentBalance / Math.max(1, this.P);
                            currentPeriodicContrib = (this.splitFixedRepayment + this.splitVariableRepayment) * ratio;
                            balanceNotes.push("Split Started");
                        } else if (!isInsideSplitTerm) {
                            currentPeriodicContrib = Math.round(this.calculateRepayment(currentBalance, currentRate, remainingPeriods, ppy) * 100) / 100;
                            balanceNotes.push("Split Ended");
                        }
                    }
                }
                previousIsSplitTerm = isInsideSplitTerm;

                // Annual Fee
                if (annualFee > 0 && p > 1) {
                    const currentYear = currentDate.getFullYear();
                    if (currentYear > lastFeeYear && currentDate.getMonth() >= loanStart.getMonth()) {
                        currentBalance += annualFee;
                        balanceNotes.push(`Fee +${fmtCurrency(annualFee)}`);
                        lastFeeYear = currentYear;
                    }
                }

                // Interventions
                const periodInterventions = interventions.filter(i => {
                    const iDate = new Date(i.date);
                    if (this.freq === 'monthly') return iDate.getFullYear() === currentDate.getFullYear() && iDate.getMonth() === currentDate.getMonth();
                    const nextDate = new Date(currentDate);
                    nextDate.setDate(nextDate.getDate() + daysPerPeriod);
                    return iDate >= currentDate && iDate < nextDate;
                });

                periodInterventions.forEach(ev => {
                    if (ev.type === 'lump_sum') { currentBalance -= ev.value; balanceNotes.push(`Lump -${fmtCurrency(ev.value)}`); }
                    else if (ev.type === 'rate_change' && !isInsideFixedTerm) {
                        currentRate = ev.value; balanceNotes.push(`Rate→${ev.value}%`);
                        const rem = contractPeriods - p + 1;
                        if (rem > 0 && !this.repaymentOverride) currentPeriodicContrib = Math.round(this.calculateRepayment(currentBalance, currentRate, rem, ppy) * 100) / 100;
                    }
                    else if (ev.type === 'offset_add') { currentOffset += ev.value; offsetNotes.push(`+${fmtCurrency(ev.value)}`); }
                    else if (ev.type === 'redraw_add') { currentRedraw += ev.value; redrawNotes.push(`+${fmtCurrency(ev.value)}`); }
                });

                if (currentBalance < 0) currentBalance = 0;
                if (!neutralityDate && (currentOffset + currentRedraw) >= currentBalance && currentBalance > 0) neutralityDate = new Date(currentDate);

                // Interest and Principal (Daily Calculation)
		let interest = 0;
		const effectivePrincipal = Math.max(0, currentBalance - currentOffset - currentRedraw);

		// Calculate actual days in this period
		const nextDate = new Date(currentDate);
		if (this.freq === 'monthly') {
    		nextDate.setMonth(nextDate.getMonth() + 1);
		} else {
		    nextDate.setDate(nextDate.getDate() + daysPerPeriod);
		}
		const daysInPeriod = Math.round((nextDate - currentDate) / (1000 * 60 * 60 * 24));

		if (isInsideSplitTerm && !isInsideFixedTerm) {
		    const initialSplitRatio = splitAmount / Math.max(1, this.P);
		    const sPortion = Math.min(currentBalance * initialSplitRatio, currentBalance);
 		   const effSPortion = Math.max(0, sPortion - (currentOffset + currentRedraw) * (sPortion / currentBalance));
 		   const effVPortion = Math.max(0, effectivePrincipal - effSPortion);
  		  // Daily rate calculation for split loan
  		  interest = (effSPortion * (this.splitRate / 100 / 365) * daysInPeriod) + 
               (effVPortion * (currentRate / 100 / 365) * daysInPeriod);
		} else {
  		  // Daily rate calculation for standard loan
   		 interest = effectivePrincipal * (effectiveRate / 100 / 365) * daysInPeriod;
		}		

                // Adjust repayment for IO
                if (isInsideIOTerm && !this.repaymentOverride) {
                    currentPeriodicContrib = interest;
                }

                let principalPaid = currentPeriodicContrib - interest;
                if (isInsideIOTerm) principalPaid = 0; // Explicitly 0 for IO

                // Check for Refinance Pending - prevent early break if refinance is scheduled later
                const isRefinancePending = this.isRefinance && this.refinanceDate && new Date(currentDate) < this.refinanceDate;

                if (currentBalance <= 0 && !isRefinancePending) break;

                if (currentBalance <= principalPaid && !isRefinancePending) {
                    principalPaid = currentBalance; currentBalance = 0; loanEndDate = new Date(currentDate);
                    // only break if no refinance coming
                }
                else {
                    if (currentBalance <= principalPaid && isRefinancePending) {
                        // Loan technically paid off, but waiting for refinance
                        principalPaid = currentBalance;
                        currentBalance = 0;
                        if (!loanEndDate) loanEndDate = new Date(currentDate);
                    } else {
                        currentBalance -= principalPaid;
                    }
                }

                // Snapshot properties
                const currentLVR = (currentBalance / currentPropertyVal) * 100;
                const currentEquity = currentPropertyVal - currentBalance;

                // Split Repayment Breakdown for history
                let sFr = 0, sVr = 0;
                if (isInsideSplitTerm) {
                    const ratio = currentPeriodicContrib / (this.splitTotalRepayment || 1);
                    sFr = this.splitFixedRepayment * ratio;
                    sVr = this.splitVariableRepayment * ratio;
                }

                history.push({
                    p, date: new Date(currentDate), balance: currentBalance, interest, principal: principalPaid,
                    offset: currentOffset, redraw: currentRedraw, rate: effectiveRate, repayment: currentPeriodicContrib,
                    isFixed: isInsideFixedTerm, isSplit: isInsideSplitTerm, isIO: isInsideIOTerm, splitRate: isInsideSplitTerm ? this.splitRate : null,
                    variableRate: currentRate, splitFixedRepay: sFr, splitVariableRepay: sVr,
                    propertyValue: currentPropertyVal, lvr: currentLVR, equity: currentEquity,
                    note: balanceNotes.join('; '), offsetNote: offsetNotes.join('; '), redrawNote: redrawNotes.join('; ')
                });

                propertyHistory.push({ p, date: new Date(currentDate), value: currentPropertyVal, lvr: currentLVR });

                // Milestones
                const periodIndex = history.length - 1;
                const checkMilestone = (key, threshold) => {
                    if (!milestones[key] && currentLVR <= threshold && p > 1) {
                        const initLVR = (principal / this.propertyValue) * 100;
                        if (initLVR > threshold) milestones[key] = { index: periodIndex, date: new Date(currentDate), val: currentPropertyVal, balance: currentBalance };
                    }
                };
                checkMilestone('lvr90', 90); checkMilestone('lvr80', 80); checkMilestone('lvr50', 50); checkMilestone('lvr25', 25);

                // Refinance Logic
                if (this.isRefinance && this.refinanceDate) {
                    // Check if current period covers refinance date
                    const nextDate = new Date(currentDate);
                    if (this.freq === 'monthly') nextDate.setMonth(nextDate.getMonth() + 1);
                    else nextDate.setDate(nextDate.getDate() + daysPerPeriod);

                    if (this.refinanceDate >= currentDate && this.refinanceDate < nextDate) {
                        // REFINANCE EVENT TRIGGERS HERE

                        // 1. Add extra cash
                        if (this.refinanceAmount > 0) {
                            currentBalance += this.refinanceAmount;
                            balanceNotes.push(`Refinance: +${fmtCurrency(this.refinanceAmount)}`);
                        } else {
                            balanceNotes.push(`Refinance Started`);
                        }

                        // 2. Reset Loan Terms
                        // New contract length
                        contractPeriods = Math.ceil((this.refinanceTermMonths / 12) * ppy) + p; // Extend from NOW
                        totalSimulationPeriods = contractPeriods + 60; // Extend loop limit to accommodate new term

                        // Update Rate & Type
                        currentRate = this.refinanceRate;

                        // Clear loan end date if we resurrected the loan
                        if (currentBalance > 0) loanEndDate = null;

                        // Reset Rate Flags
                        isInsideSplitTerm = false;
                        isInsideFixedTerm = false;
                        isInsideIOTerm = false;
                        previousIsFixedTerm = false;
                        previousIsSplitTerm = false;
                        previousIsIOTerm = false;

                        // Setup new Fixed/IO ends if applicable
                        if (this.refinanceType === 'fixed') {
                            fixedEnd = new Date(this.refinanceDate);
                            fixedEnd.setFullYear(fixedEnd.getFullYear() + this.refinanceFixedYears);
                        } else if (this.refinanceType === 'interest_only') {
                            ioEnd = new Date(this.refinanceDate);
                            ioEnd.setFullYear(ioEnd.getFullYear() + this.refinanceIOYears);
                        } else {
                            fixedEnd = null;
                            ioEnd = null;
                        }

                        // Recalculate Repayment for the NEW balance and NEW term
                        // effectively treating 'currentBalance' as the new Principal
                        const newRemainingPeriods = Math.ceil((this.refinanceTermMonths / 12) * ppy);

                        if (this.refinanceType === 'interest_only') {
                            this.singlePeriodicRepayment = Math.round((currentBalance * (currentRate / 100) / ppy) * 100) / 100;
                            // Set flag for current iteration so rate logic picks it up immediately if needed
                            isInsideIOTerm = true;
                        } else {
                            this.singlePeriodicRepayment = Math.round(this.calculateRepayment(currentBalance, currentRate, newRemainingPeriods, ppy) * 100) / 100;
                            if (this.refinanceType === 'fixed') isInsideFixedTerm = true;
                        }
                        currentPeriodicContrib = this.singlePeriodicRepayment;

                        // Also mark this h as a refinance point for visuals
                        // Update the Refinance Point immediately for visuals
                        history[history.length - 1].balance = currentBalance;
                        history[history.length - 1].rate = currentRate;
                        history[history.length - 1].repayment = currentPeriodicContrib;
                        history[history.length - 1].note = (history[history.length - 1].note ? history[history.length - 1].note + '; ' : '') + balanceNotes[balanceNotes.length - 1];

                        this.refinanceIndex = history.length - 1;
                    }
                }

                const growthFactor = this.freq === 'monthly' ? (1 + monthlyGrowthRate) : (1 + (monthlyGrowthRate * 12 / ppy));
                currentPropertyVal *= growthFactor;
            }

            let fixedRateEnd = null, splitRateEnd = null, ioRateEnd = null;
            if (fixedEnd && history.length > 0) {
                for (let i = 0; i < history.length; i++) if (history[i].date >= fixedEnd) { fixedRateEnd = { index: i, date: new Date(fixedEnd) }; break; }
            }
            if (ioEnd && history.length > 0) {
                for (let i = 0; i < history.length; i++) if (history[i].date >= ioEnd) { ioRateEnd = { index: i, date: new Date(ioEnd) }; break; }
            }
            if (splitEnd && history.length > 0) {
                for (let i = 0; i < history.length; i++) if (history[i].date >= splitEnd) { splitRateEnd = { index: i, date: new Date(splitEnd) }; break; }
            }

            let refinanceIndexPoint = -1;
            if (this.isRefinance && history.length > 0) {
                // Approx location
                // This is handled inside loop now by this.refinanceIndex but we can double check
            }

            return { history, totalInterest, neutralityDate, neutralityIndex: neutralityDate ? history.findLastIndex(h => h.date <= neutralityDate) : -1, loanEndDate, propertyHistory, milestones, fixedRateEnd, splitRateEnd, ioRateEnd, refinanceIndex: this.refinanceIndex };
        }
    }

    // --- UI Elements ---
    const Inputs = {
        amount: document.getElementById('loan-amount'),
        rate: document.getElementById('interest-rate'),
        termYears: document.getElementById('loan-term-years'),
        termMonths: document.getElementById('loan-term-months'),
        freq: document.getElementById('payment-frequency'),
        offset: document.getElementById('offset-balance'),
        redraw: document.getElementById('redraw-balance'),
        fees: document.getElementById('mortgage-fees'),
        loanStart: document.getElementById('loan-start-date'),
        repayStart: document.getElementById('repayment-start-date'),
        repaymentOverride: document.getElementById('repayment-override'),
        rateVariable: document.getElementById('rate-variable'),
        rateFixed: document.getElementById('rate-fixed'),
        rateSplit: document.getElementById('rate-split'),
        rateInterestOnly: document.getElementById('rate-interest-only'),
        fixedYears: document.getElementById('fixed-years'),
        fixedRateVal: document.getElementById('fixed-rate-val'),
        fixedStartDate: document.getElementById('fixed-start-date'),
        fixedOptionsDiv: document.getElementById('fixed-options'),
        ioOptionsDiv: document.getElementById('interest-only-options'),
        ioYears: document.getElementById('io-years'),
        ioRateVal: document.getElementById('io-rate-val'),
        ioStartDate: document.getElementById('io-start-date'),
        splitOptionsDiv: document.getElementById('split-options'),
        splitTypePercent: document.getElementById('split-type-percent'),
        splitTypeValue: document.getElementById('split-type-value'),
        splitPercent: document.getElementById('split-percent'),
        splitValue: document.getElementById('split-value'),
        splitYears: document.getElementById('split-years'),
        splitRate: document.getElementById('split-rate'),
        splitStartDate: document.getElementById('split-start-date'),
        splitPercentGroup: document.getElementById('split-percent-group'),
        splitValueGroup: document.getElementById('split-value-group'),
        propValue: document.getElementById('property-value'),
        propGrowth: document.getElementById('property-growth'),

        // Refinance inputs
        refinanceToggleOff: document.getElementById('refinance-toggle-off'),
        refinanceToggleOn: document.getElementById('refinance-toggle-on'),
        refinanceOptions: document.getElementById('refinance-options'),
        refinanceDate: document.getElementById('refinance-date'),
        refinanceAmount: document.getElementById('refinance-amount'),
        refinanceTerm: document.getElementById('refinance-term-years'),
        refinanceRate: document.getElementById('refinance-rate'),
        refinanceType: document.getElementById('refinance-type'),
        refinanceFixedDetails: document.getElementById('refinance-fixed-details'),
        refinanceFixedYears: document.getElementById('refinance-fixed-years'),
        refinanceIODetails: document.getElementById('refinance-io-details'),
        refinanceIOYears: document.getElementById('refinance-io-years')
    };

    const Outputs = {
        interest: document.getElementById('total-interest'),
        totalRepayment: document.getElementById('total-repayment'),
        interestSaved: document.getElementById('interest-saved'),
        timeSaved: document.getElementById('time-saved'),
        neutralityDate: document.getElementById('neutrality-date'),
        loanEndDate: document.getElementById('loan-end-date'),
        ledger: document.querySelector('#ledger-table tbody'),
        interventionList: document.getElementById('intervention-list'),
        splitFixedRepay: document.getElementById('split-fixed-repayment'),
        splitVarRepay: document.getElementById('split-variable-repayment'),
        splitTotalRepay: document.getElementById('split-total-repayment')
    };

    const IntUI = {
        date: document.getElementById('int-date'),
        type: document.getElementById('int-type'),
        value: document.getElementById('int-value'),
        recurrence: document.getElementById('int-recurrence'),
        addBtn: document.getElementById('add-intervention-btn')
    };

    const engine = new MortgageEngine();
    let chartInstance = null, equityChartInstance = null;
    let localInterventions = [], rateMode = 'variable', splitType = 'percent';
    let isRefinanceEnabled = false;
    let chartView = 'standard', ledgerView = 'standard';

    function fmtCurrency(val) { return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(val); }
    function fmtDate(date) { return date.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' }); }
    function monthsBetween(d1, d2) { if (!d1 || !d2) return 0; return (d2.getFullYear() - d1.getFullYear()) * 12 + (d2.getMonth() - d1.getMonth()); }
    function getPeriodLabel(freq) { const f = (freq || 'monthly').toLowerCase(); if (f === 'fortnightly') return 'Fortnight'; if (f === 'weekly') return 'Week'; return 'Month'; }

    let currentFixedRateEnd = null, currentSplitRateEnd = null, currentIORateEnd = null, currentNeutralityIndex = -1, currentEquityMilestones = {}, currentRefinanceIndex = -1;

    function update() {
        const loanStart = Inputs.loanStart.valueAsDate || new Date();
        const repayStart = Inputs.repayStart.valueAsDate || loanStart;
        engine.P = parseFloat(Inputs.amount.value) || 0;
        engine.fees = parseFloat(Inputs.fees.value) || 0;
        engine.r = parseFloat(Inputs.rate.value) || 0;
        engine.termMonths = (parseInt(Inputs.termYears.value) || 0) * 12 + (parseInt(Inputs.termMonths.value) || 0);
        engine.freq = Inputs.freq.value;
        engine.offset = parseFloat(Inputs.offset.value) || 0;
        engine.redraw = parseFloat(Inputs.redraw.value) || 0;
        engine.loanStartDate = loanStart;
        engine.repaymentStartDate = repayStart;
        engine.isFixed = (rateMode === 'fixed');
        engine.fixedDurationYears = parseInt(Inputs.fixedYears.value) || 0;
        engine.fixedRate = parseFloat(Inputs.fixedRateVal.value) || 0;
        engine.fixedStartDate = Inputs.fixedStartDate.valueAsDate || loanStart;
        engine.isInterestOnly = (rateMode === 'interest_only');
        engine.ioDurationYears = parseInt(Inputs.ioYears.value) || 0;
        engine.ioRate = parseFloat(Inputs.ioRateVal.value) || 0;
        engine.ioStartDate = Inputs.ioStartDate.valueAsDate || loanStart;
        engine.isSplit = (rateMode === 'split');
        engine.splitType = splitType;
        engine.splitPercent = parseFloat(Inputs.splitPercent.value) || 50;
        engine.splitValue = parseFloat(Inputs.splitValue.value) || 0;
        engine.splitRate = parseFloat(Inputs.splitRate.value) || 0;
        engine.splitDurationYears = parseInt(Inputs.splitYears.value) || 0;
        engine.splitStartDate = Inputs.splitStartDate.valueAsDate || loanStart;
        engine.propertyValue = parseFloat(Inputs.propValue.value) || 0;
        engine.growthRate = parseFloat(Inputs.propGrowth.value) || 0;
        engine.repaymentOverride = parseFloat(Inputs.repaymentOverride.value) || null;
        engine.interventions = localInterventions.flatMap(i => expandIntervention(i, repayStart));
        engine.growthRate = parseFloat(Inputs.propGrowth.value) || 0;
        engine.repaymentOverride = parseFloat(Inputs.repaymentOverride.value) || null;
        engine.interventions = localInterventions.flatMap(i => expandIntervention(i, repayStart));

        // Refinance params
        engine.isRefinance = isRefinanceEnabled;
        // Robust date parsing
        engine.refinanceDate = Inputs.refinanceDate.valueAsDate;
        if (!engine.refinanceDate && Inputs.refinanceDate.value) engine.refinanceDate = new Date(Inputs.refinanceDate.value);
        engine.refinanceAmount = parseFloat(Inputs.refinanceAmount.value) || 0;
        engine.refinanceTermMonths = (parseInt(Inputs.refinanceTerm.value) || 30) * 12;
        engine.refinanceRate = parseFloat(Inputs.refinanceRate.value) || 0;
        engine.refinanceType = Inputs.refinanceType.value;
        engine.refinanceFixedYears = parseInt(Inputs.refinanceFixedYears.value) || 0;
        engine.refinanceIOYears = parseInt(Inputs.refinanceIOYears.value) || 0;

        engine.calculate();

        const expectedRepay = (rateMode === 'split') ? engine.splitTotalRepayment : engine.periodicRepayment;
        Inputs.repaymentOverride.placeholder = expectedRepay > 0 ? expectedRepay.toFixed(2) : '';

        const splitBreakdownDiv = document.getElementById('split-repayment-breakdown');
        if (rateMode === 'split') {
            splitBreakdownDiv.style.display = 'block';
            if (Outputs.splitFixedRepay) Outputs.splitFixedRepay.textContent = fmtCurrency(engine.splitFixedRepayment);
            if (Outputs.splitVarRepay) Outputs.splitVarRepay.textContent = fmtCurrency(engine.splitVariableRepayment);
            if (Outputs.splitTotalRepay) Outputs.splitTotalRepay.textContent = fmtCurrency(engine.splitTotalRepayment);
            const loanAmount = engine.P;
            let fixedAmount = (splitType === 'percent') ? (loanAmount * engine.splitPercent / 100) : engine.splitValue;
            let variableAmount = loanAmount - fixedAmount;
            document.getElementById('split-fixed-amount').textContent = (splitType === 'percent') ? `${engine.splitPercent}% (${fmtCurrency(fixedAmount)})` : `${fmtCurrency(fixedAmount)} (${(fixedAmount / loanAmount * 100).toFixed(1)}%)`;
            document.getElementById('split-variable-amount').textContent = (splitType === 'percent') ? `${100 - engine.splitPercent}% (${fmtCurrency(variableAmount)})` : `${fmtCurrency(variableAmount)} (${(variableAmount / loanAmount * 100).toFixed(1)}%)`;
        } else splitBreakdownDiv.style.display = 'none';

        Outputs.interest.textContent = fmtCurrency(engine.totalInterest);
        const totalRepaid = engine.history.reduce((sum, h) => sum + h.repayment, 0);
        Outputs.totalRepayment.textContent = fmtCurrency(totalRepaid);
        const interestSaved = engine.baselineInterest - engine.totalInterest;
        Outputs.interestSaved.textContent = interestSaved > 0 ? fmtCurrency(interestSaved) : '-';
        if (engine.monthsSaved > 0) { Outputs.timeSaved.textContent = `${Math.floor(engine.monthsSaved / 12)}y ${Math.round(engine.monthsSaved % 12)}m`; } else Outputs.timeSaved.textContent = '-';
        Outputs.neutralityDate.textContent = engine.neutralityDate ? fmtDate(engine.neutralityDate) : '-';
        Outputs.loanEndDate.textContent = engine.loanEndDate ? fmtDate(engine.loanEndDate) : '-';

        currentFixedRateEnd = engine.fixedRateEnd;
        currentSplitRateEnd = engine.splitRateEnd;
        currentIORateEnd = engine.ioRateEnd;
        currentNeutralityIndex = engine.neutralityIndex;
        currentEquityMilestones = engine.milestones;
        currentRefinanceIndex = engine.refinanceIndex;
        renderChart(engine.history, engine.comparisonHistory);
        renderEquityChart(engine.history, null, engine.milestones);
        renderLedger(engine.history);
    }

    function expandIntervention(item, baseDate) {
        const occurrences = [];
        const maxDate = new Date(baseDate); maxDate.setFullYear(maxDate.getFullYear() + 60);
        if (item.recurrence === 'once' || item.type === 'rate_change') return [item];
        let currDate = new Date(item.date);
        while (currDate <= maxDate) {
            occurrences.push({ ...item, date: new Date(currDate) });
            if (item.recurrence === 'weekly') currDate.setDate(currDate.getDate() + 7);
            else if (item.recurrence === 'fortnightly') currDate.setDate(currDate.getDate() + 14);
            else if (item.recurrence === 'monthly') currDate.setMonth(currDate.getMonth() + 1);
            else if (item.recurrence === 'yearly') currDate.setFullYear(currDate.getFullYear() + 1);
            else break;
        }
        return occurrences;
    }

    const fixedRateLinePlugin = {
        id: 'fixedRateLine',
        afterDatasetsDraw: (chart) => {
            const ctx = chart.ctx, yAxis = chart.scales.y;
            const drawLine = (x, label, color, isBottom = false) => {
                ctx.save(); ctx.beginPath(); ctx.moveTo(x, yAxis.top); ctx.lineTo(x, yAxis.bottom); ctx.lineWidth = 2; ctx.strokeStyle = color; ctx.setLineDash([5, 5]); ctx.stroke();
                ctx.fillStyle = color; ctx.font = 'bold 11px Outfit'; ctx.fillText(label, x + 4, isBottom ? yAxis.bottom - 25 : yAxis.top + 12); ctx.restore();
            };

            const meta = chart.getDatasetMeta(0);
            if (currentFixedRateEnd && meta.data[currentFixedRateEnd.index]) {
                drawLine(meta.data[currentFixedRateEnd.index].x, 'Fixed → Variable', '#ed8936');
            }
            if (currentSplitRateEnd && meta.data[currentSplitRateEnd.index]) {
                drawLine(meta.data[currentSplitRateEnd.index].x, 'Split → Variable', '#48bb78', true);
            }
            if (currentIORateEnd && meta.data[currentIORateEnd.index]) {
                drawLine(meta.data[currentIORateEnd.index].x, 'Interest Only Ends', '#805ad5', true);
            }

            // Draw lines for intervention rate changes
            engine.history.forEach((h, i) => {
                if (h.note && h.note.includes('Rate→') && meta.data[i]) {
                    drawLine(meta.data[i].x, 'Rate Change', '#e53e3e', true);
                }
            });
        }
    };

    const verticalLinePlugin = {
        id: 'verticalLine',
        afterDatasetsDraw: (chart) => {
            const ctx = chart.ctx, yAxis = chart.scales.y;

            // Refinance Line
            if (currentRefinanceIndex > 0) {
                const meta = chart.getDatasetMeta(0);
                if (meta.data[currentRefinanceIndex]) {
                    const x = meta.data[currentRefinanceIndex].x;
                    ctx.save(); ctx.beginPath(); ctx.moveTo(x, yAxis.top); ctx.lineTo(x, yAxis.bottom);
                    ctx.lineWidth = 2; ctx.strokeStyle = '#3182ce'; ctx.setLineDash([]); ctx.stroke();
                    ctx.fillStyle = '#3182ce'; ctx.font = 'bold 11px Outfit'; ctx.fillText('Refinance', x + 5, yAxis.top + 25);
                    ctx.restore();
                }
            }

            Object.entries(currentEquityMilestones).forEach(([key, m]) => {
                if (!m) return;
                // Only draw LVR lines on Equity Chart (canvas id equityChart)
                if (chart.canvas.id === 'equityChart') {
                    const meta = chart.getDatasetMeta(0); if (!meta.data[m.index]) return;
                    const x = meta.data[m.index].x;
                    ctx.save(); ctx.beginPath(); ctx.moveTo(x, yAxis.top); ctx.lineTo(x, yAxis.bottom); ctx.lineWidth = 1; ctx.strokeStyle = '#a0aec0'; ctx.setLineDash([2, 4]); ctx.stroke();
                    ctx.fillStyle = '#718096'; ctx.font = 'bold 10px Outfit'; ctx.fillText(key.toUpperCase().replace('LVR', 'LVR '), x + 4, yAxis.bottom - 10); ctx.restore();
                }
            });
        }
    };

    function renderChart(history, comparisonHistory) {
        const ppy = engine.getPeriodsPerYear();
        const labels = history.map(h => (h.p - 1) % ppy === 0 ? fmtDate(h.date) : '');
        // For comparison, we might need to extend labels if comparison is longer?
        // Usually Refinance extends term, so history is longer.
        // If Refinance shortens term, comparison might be longer.
        // Let's use the longer of the two for labels if needed, or just ChartJS handles it if we provide correct x/y?
        // ChartJS with 'category' scale (default for labels) relies on index.
        // If we want correct mapping, we should ensure labels cover the max range.

        let maxLen = history.length;
        if (comparisonHistory && comparisonHistory.length > maxLen) {
            maxLen = comparisonHistory.length;
            // Re-generate labels for max length
            // We can infer dates for the longer one.
            // But simple approach: Just map the primary history labels.
            // If comparison is longer, it might get cut off or behave oddly without labels.
            // Let's safe-guard:
        }

        // Actually, let's just use the current history labels for now. 
        // If comparison extends beyond, we might miss it in 'category' mode, but 'balance' usually goes to 0 earlier or later.

        if (chartView === 'yearly') { renderYearlyChart(history, document.getElementById('loanChart').getContext('2d')); return; }
        if (chartInstance) chartInstance.destroy();

        const datasets = [
            {
                label: 'Balance',
                data: history.map(h => h.balance),
                borderColor: '#7cb9a8',
                fill: true,
                tension: 0.4,
                pointRadius: (ctx) => {
                    if (ctx.dataIndex === currentNeutralityIndex) return 8;
                    const h = history[ctx.dataIndex];
                    return (h && h.note && h.note.includes('Rate→')) ? 6 : 0;
                },
                pointStyle: (ctx) => {
                    if (ctx.dataIndex === currentNeutralityIndex) return 'rect';
                    return 'circle';
                },
                pointBackgroundColor: (ctx) => {
                    if (ctx.dataIndex === currentNeutralityIndex) return '#48bb78';
                    return '#7cb9a8';
                },
                pointBorderColor: (ctx) => {
                    if (ctx.dataIndex === currentNeutralityIndex) return '#fff';
                    return '#7cb9a8';
                }
            }
        ];

        // Add Comparison Line if Refinance is Active
        if (isRefinanceEnabled && comparisonHistory && comparisonHistory.length > 0) {
            datasets.push({
                label: 'Old Loan Path',
                data: comparisonHistory.map(h => h.balance),
                borderColor: '#cbd5e0', // Light grey
                borderDash: [5, 5],
                borderWidth: 2,
                fill: false,
                pointRadius: 0,
                tension: 0.4
            });
        }

        datasets.push(
            { label: 'Offset+Redraw', data: history.map(h => h.offset + h.redraw), borderColor: '#a0aec0', borderDash: [5, 5], fill: false, pointRadius: 0 },
            { label: 'Effective', data: history.map(h => Math.max(0, h.balance - h.offset - h.redraw)), borderColor: '#e53e3e', borderDash: [2, 2], fill: false, pointRadius: 0 }
        );

        chartInstance = new Chart(document.getElementById('loanChart').getContext('2d'), {
            type: 'line',
            data: {
                labels: labels,
                datasets: datasets
            },
            options: {
                responsive: true, maintainAspectRatio: false, animation: false,
                interaction: { intersect: false, mode: 'index' },
                plugins: {
                    legend: { labels: { color: '#718096' } },
                    tooltip: {
                        backgroundColor: 'rgba(45, 55, 72, 0.95)',
                        callbacks: {
                            title: (ctx) => { const h = history[ctx[0].dataIndex]; return `${getPeriodLabel(engine.freq)} ${h.p} — ${fmtDate(h.date)}`; },
                            afterTitle: (ctx) => {
                                const h = history[ctx[0].dataIndex];
                                if (h.isSplit) return `Split Loan: ${h.splitRate.toFixed(2)}% (F) / ${h.variableRate.toFixed(2)}% (V)`;
                                if (h.isIO) return `Interest Only: ${h.rate.toFixed(2)}%`;
                                return `${h.isFixed ? 'Fixed Rate' : 'Variable Rate'}: ${h.rate.toFixed(2)}%`;
                            },
                            afterBody: (ctx) => {
                                const h = history[ctx[0].dataIndex];
                                const lines = [`Repayment: ${h.isIO ? 'Interest Only Repayment' : 'Repayment'}: ${fmtCurrency(h.repayment)}`, `Interest: ${fmtCurrency(h.interest)}`, `Principal: ${fmtCurrency(h.principal)}`];
                                if (h.isSplit) { lines.push('--- Split Breakdown ---', `Fixed Repay: ${fmtCurrency(h.splitFixedRepay)}`, `Var Repay: ${fmtCurrency(h.splitVariableRepay)}`); }
                                return lines;
                            }
                        }
                    }
                }
            },
            plugins: [fixedRateLinePlugin, verticalLinePlugin]
        });
    }



    function renderYearlyChart(history, ctx) {
        const yearly = []; const ppy = engine.getPeriodsPerYear();
        for (let i = 0; i < history.length; i += ppy) {
            const chunk = history.slice(i, i + ppy); const last = chunk[chunk.length - 1];
            yearly.push({ year: Math.floor(i / ppy) + 1, interest: chunk.reduce((s, h) => s + h.interest, 0), balance: last.balance });
        }
        if (chartInstance) chartInstance.destroy();
        chartInstance = new Chart(ctx, {
            type: 'bar',
            data: { labels: yearly.map(y => `Year ${y.year}`), datasets: [{ label: 'End Balance', data: yearly.map(y => y.balance), type: 'line', borderColor: '#7cb9a8' }, { label: 'Yearly Interest', data: yearly.map(y => y.interest), backgroundColor: '#f6ad55' }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#718096' } } } }
        });
    }

    function renderEquityChart(history) {
        const ppy = engine.getPeriodsPerYear();
        const labels = history.map(h => (h.p - 1) % ppy === 0 ? fmtDate(h.date) : '');
        if (equityChartInstance) equityChartInstance.destroy();
        equityChartInstance = new Chart(document.getElementById('equityChart').getContext('2d'), {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    { label: 'Property Value', data: history.map(h => h.propertyValue), borderColor: '#48bb78', backgroundColor: 'rgba(72,187,120,0.1)', fill: true, pointRadius: 0 },
                    { label: 'Loan Balance', data: history.map(h => h.balance), borderColor: '#e53e3e', backgroundColor: 'rgba(229,62,62,0.1)', fill: true, pointRadius: 0 }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false, animation: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    tooltip: {
                        callbacks: {
                            afterBody: (ctx) => {
                                const h = history[ctx[0].dataIndex]; if (!h) return [];
                                return ['----------------', `Equity: ${fmtCurrency(h.equity)}`, `LVR: ${h.lvr.toFixed(1)}%`];
                            }
                        }
                    }
                }
            },
            plugins: [verticalLinePlugin]
        });
    }

    function renderLedger(history) {
        Outputs.ledger.innerHTML = ''; const frag = document.createDocumentFragment();
        const pLabel = getPeriodLabel(engine.freq);
        let data = history;
        if (ledgerView === 'yearly') {
            data = []; const ppy = engine.getPeriodsPerYear();
            for (let i = 0; i < history.length; i += ppy) {
                const chunk = history.slice(i, i + ppy); const last = chunk[chunk.length - 1];
                const allNotes = chunk.map(h => h.note).filter(Boolean).join('; ');
                const allOffsetNotes = chunk.map(h => h.offsetNote).filter(Boolean).join('; ');
                const allRedrawNotes = chunk.map(h => h.redrawNote).filter(Boolean).join('; ');
                data.push({
                    p: `Year ${Math.floor(i / ppy) + 1}`,
                    date: last.date,
                    repayment: chunk.reduce((s, h) => s + h.repayment, 0),
                    interest: chunk.reduce((s, h) => s + h.interest, 0),
                    principal: chunk.reduce((s, h) => s + h.principal, 0),
                    balance: last.balance,
                    offset: last.offset,
                    redraw: last.redraw,
                    rate: last.rate,
                    isYearly: true,
                    note: allNotes,
                    offsetNote: allOffsetNotes,
                    redrawNote: allRedrawNotes
                });
            }
        } else if (ledgerView === 'monthly') {
            data = []; let curM = null, curC = [];
            history.forEach((h, idx) => {
                const m = h.date.getFullYear() + '-' + h.date.getMonth();
                if (curM !== null && m !== curM) {
                    const l = curC[curC.length - 1];
                    const allNotes = curC.map(r => r.note).filter(Boolean).join('; ');
                    const allOffsetNotes = curC.map(r => r.offsetNote).filter(Boolean).join('; ');
                    const allRedrawNotes = curC.map(r => r.redrawNote).filter(Boolean).join('; ');
                    data.push({
                        p: `Month ${data.length + 1}`,
                        date: l.date,
                        repayment: curC.reduce((s, r) => s + r.repayment, 0),
                        interest: curC.reduce((s, r) => s + r.interest, 0),
                        principal: curC.reduce((s, r) => s + r.principal, 0),
                        balance: l.balance,
                        offset: l.offset,
                        redraw: l.redraw,
                        rate: l.rate,
                        isMonthly: true,
                        note: allNotes,
                        offsetNote: allOffsetNotes,
                        redrawNote: allRedrawNotes
                    });
                    curC = [];
                }
                curM = m; curC.push(h);
                if (idx === history.length - 1) {
                    const l = curC[curC.length - 1];
                    const allNotes = curC.map(r => r.note).filter(Boolean).join('; ');
                    const allOffsetNotes = curC.map(r => r.offsetNote).filter(Boolean).join('; ');
                    const allRedrawNotes = curC.map(r => r.redrawNote).filter(Boolean).join('; ');
                    data.push({
                        p: `Month ${data.length + 1}`,
                        date: l.date,
                        repayment: curC.reduce((s, r) => s + r.repayment, 0),
                        interest: curC.reduce((s, r) => s + r.interest, 0),
                        principal: curC.reduce((s, r) => s + r.principal, 0),
                        balance: l.balance,
                        offset: l.offset,
                        redraw: l.redraw,
                        rate: l.rate,
                        isMonthly: true,
                        note: allNotes,
                        offsetNote: allOffsetNotes,
                        redrawNote: allRedrawNotes
                    });
                }
            });
        }

        data.forEach(row => {
            const tr = document.createElement('tr');
            let rateText = `${row.rate.toFixed(2)}%`;
            if (engine.isFixed && row.date < (new Date(engine.fixedStartDate.getTime()).setFullYear(engine.fixedStartDate.getFullYear() + engine.fixedDurationYears)) && row.date >= engine.fixedStartDate) {
                tr.classList.add('fixed-rate-row'); rateText = `<span style="color:#ed8936">${row.rate.toFixed(2)}% (Fixed)</span>`;
            } else if (engine.isInterestOnly && row.date < (new Date(engine.ioStartDate.getTime()).setFullYear(engine.ioStartDate.getFullYear() + engine.ioDurationYears)) && row.date >= engine.ioStartDate) {
                tr.classList.add('fixed-rate-row'); rateText = `<span style="color:#805ad5">${row.rate.toFixed(2)}% (IO)</span>`;
            } else if (engine.isSplit && row.date < (new Date(engine.splitStartDate.getTime()).setFullYear(engine.splitStartDate.getFullYear() + engine.splitDurationYears)) && row.date >= engine.splitStartDate) {
                tr.classList.add('split-rate-row'); rateText = `<span style="color:#48bb78">${engine.splitRate.toFixed(2)}% (F)</span> / ${row.rate.toFixed(2)}% (V)`;
            }
            if (!row.isYearly && !row.isMonthly && (row.note || row.offsetNote || row.redrawNote)) tr.classList.add('highlight');
            tr.innerHTML = `<td>${row.isYearly || row.isMonthly ? row.p : pLabel + ' ' + row.p}</td>
                <td>${fmtDate(row.date)}</td>
                <td style="font-size:0.85rem">${rateText}</td>
                <td>${fmtCurrency(row.repayment)}</td>
                <td style="color:#e53e3e">${fmtCurrency(row.interest)}</td>
                <td style="color:#48bb78">${fmtCurrency(row.principal)}</td>
                <td>${fmtCurrency(row.offset || 0)}${row.offsetNote ? '<br><small style="font-size:0.7rem; color:#718096">(' + row.offsetNote + ')</small>' : ''}</td>
                <td>${fmtCurrency(row.redraw || 0)}${row.redrawNote ? '<br><small style="font-size:0.7rem; color:#718096">(' + row.redrawNote + ')</small>' : ''}</td>
                <td><strong>${fmtCurrency(row.balance)}</strong>${row.note ? '<br><small>(' + row.note + ')</small>' : ''}</td>`;
            frag.appendChild(tr);
        });
        Outputs.ledger.appendChild(frag);
    }

    function addIntervention() {
        const d = IntUI.date.valueAsDate, t = IntUI.type.value, v = parseFloat(IntUI.value.value), rec = IntUI.recurrence.value;
        if (!d || isNaN(v) || v <= 0) return;
        localInterventions.push({ id: Date.now(), date: new Date(d), type: t, value: v, recurrence: (t === 'rate_change' ? 'once' : rec) });
        renderInterventionList(); update(); IntUI.value.value = '';
    }

    // FAQ Toggle
    const faqHeader = document.getElementById('faq-toggle');
    const faqContent = document.getElementById('faq-content');
    if (faqHeader && faqContent) {
        faqHeader.addEventListener('click', () => {
            const isHidden = faqContent.style.display === 'none';
            faqContent.style.display = isHidden ? 'block' : 'none';
            faqHeader.classList.toggle('active', isHidden);
        });
    }


    function renderInterventionList() {
        Outputs.interventionList.innerHTML = '';
        localInterventions.sort((a, b) => a.date - b.date).forEach(i => {
            const div = document.createElement('div'); div.className = 'intervention-item';
            let desc = i.type === 'lump_sum' ? `Pay ${fmtCurrency(i.value)}` : i.type === 'rate_change' ? `Rate → ${i.value}%` : i.type === 'offset_add' ? `Offset +${fmtCurrency(i.value)}` : `Redraw +${fmtCurrency(i.value)}`;
            div.innerHTML = `<span>${fmtDate(i.date)}: ${desc}${i.recurrence === 'once' ? '' : ` (${i.recurrence})`}</span> <span class="remove-btn" onclick="removeIntervention(${i.id})">×</span>`;
            Outputs.interventionList.appendChild(div);
        });
    }

    window.removeIntervention = (id) => { localInterventions = localInterventions.filter(i => i.id !== id); renderInterventionList(); update(); };

    function setRateMode(mode) {
        rateMode = mode;
        Inputs.rateVariable.classList.toggle('active', mode === 'variable');
        Inputs.rateFixed.classList.toggle('active', mode === 'fixed');
        Inputs.rateSplit.classList.toggle('active', mode === 'split');
        Inputs.rateInterestOnly.classList.toggle('active', mode === 'interest_only');
        Inputs.fixedOptionsDiv.style.display = (mode === 'fixed' ? 'block' : 'none');
        Inputs.splitOptionsDiv.style.display = (mode === 'split' ? 'block' : 'none');
        Inputs.ioOptionsDiv.style.display = (mode === 'interest_only' ? 'block' : 'none');
        update();
    }
    function setSplitType(type) { splitType = type; Inputs.splitTypePercent.classList.toggle('active', type === 'percent'); Inputs.splitTypeValue.classList.toggle('active', type === 'value'); Inputs.splitPercentGroup.style.display = (type === 'percent' ? 'block' : 'none'); Inputs.splitValueGroup.style.display = (type === 'value' ? 'block' : 'none'); update(); }

    Inputs.rateVariable.addEventListener('click', () => setRateMode('variable'));
    Inputs.rateFixed.addEventListener('click', () => setRateMode('fixed'));
    Inputs.rateSplit.addEventListener('click', () => setRateMode('split'));
    Inputs.rateInterestOnly.addEventListener('click', () => setRateMode('interest_only'));
    Inputs.splitTypePercent.addEventListener('click', () => setSplitType('percent'));
    Inputs.splitTypeValue.addEventListener('click', () => setSplitType('value'));
    IntUI.type.addEventListener('change', () => {
        const isRateChange = IntUI.type.value === 'rate_change';
        if (isRateChange) {
            IntUI.recurrence.value = 'once';
        }
        Array.from(IntUI.recurrence.options).forEach(opt => {
            opt.style.display = (isRateChange && opt.value !== 'once') ? 'none' : 'block';
        });
        IntUI.recurrence.disabled = isRateChange;
    });
    IntUI.addBtn.addEventListener('click', addIntervention);

    function syncDateMin() {
        if (!Inputs.loanStart.value) return;
        const loanStart = Inputs.loanStart.valueAsDate;
        const minStr = loanStart.toISOString().split('T')[0];

        // Helper to update min and correct value if needed
        const updateDateInput = (input) => {
            input.min = minStr;
            if (input.valueAsDate && input.valueAsDate < loanStart) {
                input.valueAsDate = loanStart; // Reset to start date if before
            }
        };

        updateDateInput(Inputs.repayStart);
        updateDateInput(Inputs.fixedStartDate);
        updateDateInput(Inputs.splitStartDate);
        updateDateInput(Inputs.ioStartDate);
        updateDateInput(IntUI.date);

        // Ensure repayment start is at least 1 month after if that's the logic (optional, but user just said 'not before')
        // We actually want Repayment to ideally be after loan start, but 'not before' is satisfied by >=.
    }

    function checkTermMonths() {
        let val = parseInt(Inputs.termMonths.value);
        if (isNaN(val)) val = 0;
        if (val < 0) val = 0;
        if (val > 11) val = 11;
        Inputs.termMonths.value = val;
    }

    function saveState() {
        const state = {
            amount: Inputs.amount.value,
            rate: Inputs.rate.value,
            termYears: Inputs.termYears.value,
            termMonths: Inputs.termMonths.value,
            freq: Inputs.freq.value,
            offset: Inputs.offset.value,
            redraw: Inputs.redraw.value,
            fees: Inputs.fees.value,
            loanStart: Inputs.loanStart.value,
            repayStart: Inputs.repayStart.value,
            repaymentOverride: Inputs.repaymentOverride.value,
            propValue: Inputs.propValue.value,
            propGrowth: Inputs.propGrowth.value,
            rateMode: rateMode,
            splitType: splitType,
            fixedYears: Inputs.fixedYears.value,
            fixedRate: Inputs.fixedRateVal.value,
            fixedStart: Inputs.fixedStartDate.value,
            ioYears: Inputs.ioYears.value,
            ioRate: Inputs.ioRateVal.value,
            ioStart: Inputs.ioStartDate.value,
            splitPercent: Inputs.splitPercent.value,
            splitValue: Inputs.splitValue.value,
            splitYears: Inputs.splitYears.value,
            splitRate: Inputs.splitRate.value,
            splitStart: Inputs.splitStartDate.value,
            interventions: localInterventions,
            chartView: chartView,
            ledgerView: ledgerView
        };
        localStorage.setItem('mortgage_calc_state', JSON.stringify(state));
    }

    function loadState() {
        const saved = localStorage.getItem('mortgage_calc_state');
        if (!saved) return false;
        try {
            const s = JSON.parse(saved);
            if (s.amount) Inputs.amount.value = s.amount;
            if (s.rate) Inputs.rate.value = s.rate;
            if (s.termYears) Inputs.termYears.value = s.termYears;
            if (s.termMonths) Inputs.termMonths.value = s.termMonths;
            if (s.freq) Inputs.freq.value = s.freq;
            if (s.offset) Inputs.offset.value = s.offset;
            if (s.redraw) Inputs.redraw.value = s.redraw;
            if (s.fees) Inputs.fees.value = s.fees;
            if (s.loanStart) Inputs.loanStart.value = s.loanStart;
            if (s.repayStart) Inputs.repayStart.value = s.repayStart;
            if (s.repaymentOverride) Inputs.repaymentOverride.value = s.repaymentOverride;
            if (s.propValue) Inputs.propValue.value = s.propValue;
            if (s.propGrowth) Inputs.propGrowth.value = s.propGrowth;

            if (s.fixedYears) Inputs.fixedYears.value = s.fixedYears;
            if (s.fixedRate) Inputs.fixedRateVal.value = s.fixedRate;
            if (s.fixedStart) Inputs.fixedStartDate.value = s.fixedStart;

            if (s.ioYears) Inputs.ioYears.value = s.ioYears;
            if (s.ioRate) Inputs.ioRateVal.value = s.ioRate;
            if (s.ioStart) Inputs.ioStartDate.value = s.ioStart;

            if (s.splitPercent) Inputs.splitPercent.value = s.splitPercent;
            if (s.splitValue) Inputs.splitValue.value = s.splitValue;
            if (s.splitYears) Inputs.splitYears.value = s.splitYears;
            if (s.splitRate) Inputs.splitRate.value = s.splitRate;
            if (s.splitStart) Inputs.splitStartDate.value = s.splitStart;

            if (s.interventions) {
                localInterventions = s.interventions.map(i => ({ ...i, date: new Date(i.date) }));
            }
            if (s.rateMode) setRateMode(s.rateMode);
            if (s.splitType) setSplitType(s.splitType);

            if (s.chartView) {
                chartView = s.chartView;
                document.getElementById('btn-chart-standard').classList.toggle('active', chartView === 'standard');
                document.getElementById('btn-chart-yearly').classList.toggle('active', chartView === 'yearly');
            }
            if (s.ledgerView) {
                ledgerView = s.ledgerView;
                document.querySelectorAll('.ledger-toggle .toggle-btn').forEach(b => b.classList.remove('active'));
                if (ledgerView === 'monthly') document.getElementById('btn-ledger-monthly').classList.add('active');
                else if (ledgerView === 'yearly') document.getElementById('btn-ledger-yearly').classList.add('active');
                else document.getElementById('btn-ledger-standard').classList.add('active');
            }

            renderInterventionList();
            return true;
        } catch (e) {
            console.error("Failed to load state", e);
            return false;
        }
    }

    function resetToDefaults() {
        localStorage.removeItem('mortgage_calc_state');
        Inputs.amount.value = 375000; Inputs.rate.value = 5.29; Inputs.termYears.value = 25; Inputs.termMonths.value = 0; Inputs.freq.value = 'monthly'; Inputs.offset.value = 100000; Inputs.redraw.value = 200; Inputs.fees.value = 299; Inputs.repaymentOverride.value = '';
        Inputs.loanStart.valueAsDate = new Date('2026-01-01'); Inputs.repayStart.valueAsDate = new Date('2026-02-01'); Inputs.propValue.value = 500000; Inputs.propGrowth.value = 5.0;
        localInterventions = []; setRateMode('variable'); setSplitType('percent');
        renderInterventionList();
        syncDateMin(); update();
        saveState();
    }

    document.getElementById('reset-btn').addEventListener('click', resetToDefaults);
    [Inputs.amount, Inputs.rate, Inputs.termYears, Inputs.termMonths, Inputs.offset, Inputs.redraw, Inputs.fees, Inputs.propValue, Inputs.propGrowth, Inputs.repaymentOverride, Inputs.fixedRateVal, Inputs.splitPercent, Inputs.splitValue, Inputs.splitRate, Inputs.ioRateVal].forEach(el => el.addEventListener('input', () => {
        if (el === Inputs.termMonths) checkTermMonths();
        update();
        saveState();
    }));
    [Inputs.freq, Inputs.loanStart, Inputs.repayStart, Inputs.fixedYears, Inputs.fixedStartDate, Inputs.splitYears, Inputs.splitStartDate, Inputs.ioYears, Inputs.ioStartDate].forEach(el => el.addEventListener('change', () => {
        if (el === Inputs.loanStart) syncDateMin();
        update();
        saveState();
    }));

    document.getElementById('btn-chart-standard').addEventListener('click', () => { chartView = 'standard'; document.getElementById('btn-chart-standard').classList.add('active'); document.getElementById('btn-chart-yearly').classList.remove('active'); update(); });
    document.getElementById('btn-chart-yearly').addEventListener('click', () => { chartView = 'yearly'; document.getElementById('btn-chart-yearly').classList.add('active'); document.getElementById('btn-chart-standard').classList.remove('active'); update(); });
    document.getElementById('btn-ledger-standard').addEventListener('click', (e) => { ledgerView = 'standard'; document.querySelectorAll('.ledger-toggle .toggle-btn').forEach(b => b.classList.remove('active')); e.target.classList.add('active'); renderLedger(engine.history); });
    document.getElementById('btn-ledger-monthly').addEventListener('click', (e) => { ledgerView = 'monthly'; document.querySelectorAll('.ledger-toggle .toggle-btn').forEach(b => b.classList.remove('active')); e.target.classList.add('active'); renderLedger(engine.history); });
    document.getElementById('btn-ledger-yearly').addEventListener('click', (e) => { ledgerView = 'yearly'; document.querySelectorAll('.ledger-toggle .toggle-btn').forEach(b => b.classList.remove('active')); e.target.classList.add('active'); renderLedger(engine.history); });


    // Refinance listeners
    if (Inputs.refinanceToggleOff) {
        Inputs.refinanceToggleOff.addEventListener('click', () => {
            isRefinanceEnabled = false;
            Inputs.refinanceToggleOff.classList.add('active');
            Inputs.refinanceToggleOn.classList.remove('active');
            Inputs.refinanceOptions.style.display = 'none';
            update();
        });
        Inputs.refinanceToggleOn.addEventListener('click', () => {
            isRefinanceEnabled = true;
            Inputs.refinanceToggleOn.classList.add('active');
            Inputs.refinanceToggleOff.classList.remove('active');
            Inputs.refinanceOptions.style.display = 'block';
            update();
        });
        Inputs.refinanceType.addEventListener('change', () => {
            const t = Inputs.refinanceType.value;
            if (Inputs.refinanceFixedDetails) Inputs.refinanceFixedDetails.style.display = (t === 'fixed') ? 'block' : 'none';
            if (Inputs.refinanceIODetails) Inputs.refinanceIODetails.style.display = (t === 'interest_only') ? 'block' : 'none';
            update();
        });
        [Inputs.refinanceDate, Inputs.refinanceAmount, Inputs.refinanceTerm, Inputs.refinanceRate, Inputs.refinanceFixedYears, Inputs.refinanceIOYears].forEach(el => {
            if (el) el.addEventListener('input', update);
        });
    }

    if (!loadState()) {
        resetToDefaults(); // Initialize defaults if no state
    } else {
        syncDateMin(); update(); // Ensure logic correct after load
    }
});
