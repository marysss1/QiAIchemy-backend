export const HEALTH_RISK_ALERT_SEVERITIES = ['watch', 'high'] as const;
export type HealthRiskAlertSeverity = (typeof HEALTH_RISK_ALERT_SEVERITIES)[number];

export const HEALTH_RISK_ALERT_CODES = [
  'heart_rate_warning',
  'blood_glucose_high',
  'sleep_score_low',
  'blood_oxygen_low',
  'sleep_apnea_detected',
  'sleep_insufficient',
  'activity_steps_low',
  'daylight_low',
  'resting_heart_rate_high',
  'stand_hours_low',
  'activity_ring_open',
  'heart_rate_variability_low',
  'vo2max_low',
  'bmi_abnormal',
] as const;

export type HealthRiskAlertCode = (typeof HEALTH_RISK_ALERT_CODES)[number];

export type HealthRiskAlert = {
  code: HealthRiskAlertCode;
  severity: HealthRiskAlertSeverity;
  title: string;
  message: string;
  recommendation: string;
  value?: number;
  unit?: string;
  triggeredAt: string;
};

export type UserHealthSignal = {
  code: HealthRiskAlertCode;
  title: string;
  severity: HealthRiskAlertSeverity;
  firstDetectedAt: Date;
  lastDetectedAt: Date;
  occurrenceCount: number;
  latestValue?: number;
  unit?: string;
  latestMessage: string;
  latestRecommendation: string;
};

type TrendPointInput = {
  timestamp?: string;
  value?: number;
  unit?: string;
};

type HealthRiskSnapshotInput = {
  generatedAt: string;
  profile?: {
    heightCm?: number;
    weightKg?: number;
  };
  activity?: {
    stepsToday?: number;
    activeEnergyKcalToday?: number;
    activeEnergyGoalKcal?: number;
    exerciseMinutesToday?: number;
    exerciseGoalMinutes?: number;
    standHoursToday?: number;
    standGoalHours?: number;
    stepsHourlySeriesToday?: TrendPointInput[];
  };
  sleep?: {
    asleepMinutesLast36h?: number;
    sleepScore?: number;
    apnea?: {
      eventCountLast30d?: number;
      durationMinutesLast30d?: number;
      riskLevel?: 'none' | 'watch' | 'high' | 'unknown';
      reminder?: string;
    };
  };
  heart?: {
    latestHeartRateBpm?: number;
    restingHeartRateBpm?: number;
    heartRateVariabilityMs?: number;
    vo2MaxMlKgMin?: number;
  };
  oxygen?: {
    bloodOxygenPercent?: number;
  };
  metabolic?: {
    bloodGlucoseMgDl?: number;
  };
  environment?: {
    daylightMinutesToday?: number;
  };
  body?: {
    bodyMassKg?: number;
    bmi?: number;
  };
  huawei?: {
    activity?: {
      stepsToday?: number;
      caloriesKcalToday?: number;
      activeMinutesToday?: number;
      standingHoursToday?: number;
    };
    sleep?: {
      asleepMinutesLast24h?: number;
      sleepScore?: number;
    };
    heart?: {
      latestHeartRateBpm?: number;
      restingHeartRateBpm?: number;
      heartRateWarning?: string;
    };
    oxygen?: {
      latestSpO2Percent?: number;
    };
    stress?: {
      hrvMs?: number;
    };
    body?: {
      bmi?: number;
    };
  };
};

function severityRank(value: HealthRiskAlertSeverity): number {
  return value === 'high' ? 2 : 1;
}

function putAlert(
  alertsByCode: Map<HealthRiskAlertCode, HealthRiskAlert>,
  alert: HealthRiskAlert
): void {
  const existing = alertsByCode.get(alert.code);
  if (!existing || severityRank(alert.severity) > severityRank(existing.severity)) {
    alertsByCode.set(alert.code, alert);
  }
}

function toMmolL(valueMgDl: number): number {
  return Number((valueMgDl / 18).toFixed(1));
}

function toHours(valueMinutes: number, digits = 1): number {
  return Number((valueMinutes / 60).toFixed(digits));
}

function calculateBmi(weightKg: number, heightCm: number): number | undefined {
  if (!Number.isFinite(weightKg) || !Number.isFinite(heightCm) || weightKg <= 0 || heightCm <= 0) {
    return undefined;
  }

  const heightM = heightCm / 100;
  const bmi = weightKg / (heightM * heightM);
  return Number.isFinite(bmi) ? Number(bmi.toFixed(1)) : undefined;
}

function formatRingProgress(
  current: number | undefined,
  goal: number | undefined,
  unit: string,
  digits = 0
): string {
  const formatValue = (value: number) => value.toFixed(digits);
  if (typeof current !== 'number' || !Number.isFinite(current)) {
    return `-/ ${typeof goal === 'number' && Number.isFinite(goal) ? formatValue(goal) : '-'}${unit}`;
  }
  const goalValue = typeof goal === 'number' && Number.isFinite(goal) ? formatValue(goal) : '-';
  return `${formatValue(current)}/${goalValue}${unit}`;
}

export function detectHealthRiskAlerts(snapshot: HealthRiskSnapshotInput): HealthRiskAlert[] {
  const alertsByCode = new Map<HealthRiskAlertCode, HealthRiskAlert>();
  const triggeredAt = snapshot.generatedAt;
  const snapshotDate = new Date(triggeredAt);
  const hour = Number.isNaN(snapshotDate.getTime()) ? 12 : snapshotDate.getHours();
  const isLateDay = hour >= 18;
  const isEvening = hour >= 20;

  const latestHeartRate = snapshot.heart?.latestHeartRateBpm ?? snapshot.huawei?.heart?.latestHeartRateBpm;
  if (typeof latestHeartRate === 'number') {
    if (latestHeartRate >= 130) {
      putAlert(alertsByCode, {
        code: 'heart_rate_warning',
        severity: 'high',
        title: '心率预警',
        message: `当前心率约 ${Math.round(latestHeartRate)} bpm，明显偏高。`,
        recommendation: '请先停止活动并静坐休息；若伴胸闷、胸痛或头晕，请尽快就医。',
        value: latestHeartRate,
        unit: 'bpm',
        triggeredAt,
      });
    } else if (latestHeartRate <= 45) {
      putAlert(alertsByCode, {
        code: 'heart_rate_warning',
        severity: 'high',
        title: '心率预警',
        message: `当前心率约 ${Math.round(latestHeartRate)} bpm，偏低。`,
        recommendation: '建议静息复测；若持续偏低或伴不适，请及时线下评估。',
        value: latestHeartRate,
        unit: 'bpm',
        triggeredAt,
      });
    } else if (latestHeartRate >= 115) {
      putAlert(alertsByCode, {
        code: 'heart_rate_warning',
        severity: 'watch',
        title: '心率偏高提醒',
        message: `当前心率约 ${Math.round(latestHeartRate)} bpm，提示近期压力或恢复状态需要关注。`,
        recommendation: '建议减少刺激性饮品、适度放松并继续观察 24 小时心率趋势。',
        value: latestHeartRate,
        unit: 'bpm',
        triggeredAt,
      });
    }
  }

  const restingHeartRate = snapshot.heart?.restingHeartRateBpm ?? snapshot.huawei?.heart?.restingHeartRateBpm;
  if (typeof restingHeartRate === 'number' && restingHeartRate > 80) {
    putAlert(alertsByCode, {
      code: 'resting_heart_rate_high',
      severity: restingHeartRate >= 90 ? 'high' : 'watch',
      title: '静息心率偏高',
      message: `静息心率约 ${Math.round(restingHeartRate)} bpm，高于理想恢复区间。`,
      recommendation: '优先保证睡眠、降低咖啡因和熬夜负荷；若持续升高，请考虑线下评估。',
      value: restingHeartRate,
      unit: 'bpm',
      triggeredAt,
    });
  }

  const heartRateWarningRaw =
    typeof snapshot.huawei?.heart?.heartRateWarning === 'string'
      ? snapshot.huawei.heart.heartRateWarning.trim().toLowerCase()
      : '';
  if (heartRateWarningRaw && heartRateWarningRaw !== 'normal' && heartRateWarningRaw !== 'none') {
    putAlert(alertsByCode, {
      code: 'heart_rate_warning',
      severity: ['high', 'critical', 'danger'].includes(heartRateWarningRaw) ? 'high' : 'watch',
      title: '心率系统预警',
      message: `设备检测到心率预警标记：${heartRateWarningRaw}。`,
      recommendation: '建议结合当前症状复测，若伴心悸、胸闷或头晕，请尽快就医。',
      triggeredAt,
    });
  }

  const asleepMinutes =
    snapshot.sleep?.asleepMinutesLast36h ?? snapshot.huawei?.sleep?.asleepMinutesLast24h;
  if (typeof asleepMinutes === 'number' && asleepMinutes > 0 && asleepMinutes < 360) {
    const asleepHours = toHours(asleepMinutes);
    putAlert(alertsByCode, {
      code: 'sleep_insufficient',
      severity: asleepMinutes < 300 ? 'high' : 'watch',
      title: '睡眠不足',
      message: `最近一次可读睡眠约 ${asleepHours} 小时，少于 6 小时。`,
      recommendation: '建议今晚优先保证入睡时点，减少夜间用脑和屏幕刺激，先把睡眠补足。',
      value: asleepHours,
      unit: 'hours',
      triggeredAt,
    });
  }

  const sleepScore = snapshot.sleep?.sleepScore ?? snapshot.huawei?.sleep?.sleepScore;
  if (typeof sleepScore === 'number' && sleepScore <= 45) {
    putAlert(alertsByCode, {
      code: 'sleep_score_low',
      severity: sleepScore <= 35 ? 'high' : 'watch',
      title: '睡眠评分偏低',
      message: `本次睡眠评分约 ${Math.round(sleepScore)}，恢复质量不理想。`,
      recommendation: '建议连续 3 天提前入睡、降低晚间刺激并观察清晨精神状态变化。',
      value: sleepScore,
      unit: 'score',
      triggeredAt,
    });
  }

  const stepsToday = snapshot.activity?.stepsToday ?? snapshot.huawei?.activity?.stepsToday;
  if (typeof stepsToday === 'number' && stepsToday < 2000) {
    putAlert(alertsByCode, {
      code: 'activity_steps_low',
      severity: stepsToday < 1000 ? 'high' : 'watch',
      title: '活动不足',
      message: `今日步数约 ${Math.round(stepsToday)} 步，低于 2000 步。`,
      recommendation: '建议今天补 2-3 次、每次约 0.2 小时的快走，先把久坐状态打断。',
      value: stepsToday,
      unit: 'steps',
      triggeredAt,
    });
  }

  const daylightMinutes = snapshot.environment?.daylightMinutesToday;
  if (typeof daylightMinutes === 'number' && daylightMinutes < 20) {
    const daylightHours = toHours(daylightMinutes);
    putAlert(alertsByCode, {
      code: 'daylight_low',
      severity: daylightMinutes < 10 ? 'high' : 'watch',
      title: '光照不足',
      message: `今日日照时长约 ${daylightHours} 小时，户外光照暴露不足。`,
      recommendation: '建议白天尽量安排 0.3-0.5 小时户外步行或晒太阳，帮助节律与情绪稳定。',
      value: daylightHours,
      unit: 'hours',
      triggeredAt,
    });
  }

  const bloodOxygen = snapshot.oxygen?.bloodOxygenPercent ?? snapshot.huawei?.oxygen?.latestSpO2Percent;
  if (typeof bloodOxygen === 'number' && bloodOxygen < 95) {
    putAlert(alertsByCode, {
      code: 'blood_oxygen_low',
      severity: bloodOxygen < 90 ? 'high' : 'watch',
      title: '血氧偏低',
      message: `当前血氧约 ${Math.round(bloodOxygen)}%，低于理想水平。`,
      recommendation: '请先静息复测；若持续偏低或伴呼吸不适、晨起头痛，请及时就医。',
      value: bloodOxygen,
      unit: '%',
      triggeredAt,
    });
  }

  const standHours = snapshot.activity?.standHoursToday ?? snapshot.huawei?.activity?.standingHoursToday;
  const standGoal = snapshot.activity?.standGoalHours ?? 12;
  if (isLateDay && typeof standHours === 'number' && standHours < Math.min(6, standGoal * 0.6)) {
    putAlert(alertsByCode, {
      code: 'stand_hours_low',
      severity: standHours < 4 ? 'high' : 'watch',
      title: '站立时间不足',
      message: `截至当前站立时长约 ${Math.round(standHours)} 小时，偏少。`,
      recommendation: '建议把起身活动拆成每小时一次，先把久坐时间切碎。',
      value: standHours,
      unit: 'hours',
      triggeredAt,
    });
  }

  const moveValue = snapshot.activity?.activeEnergyKcalToday ?? snapshot.huawei?.activity?.caloriesKcalToday;
  const moveGoal = snapshot.activity?.activeEnergyGoalKcal;
  const exerciseValue = snapshot.activity?.exerciseMinutesToday ?? snapshot.huawei?.activity?.activeMinutesToday;
  const exerciseGoal = snapshot.activity?.exerciseGoalMinutes;
  const ringIssues: string[] = [];
  if (typeof moveGoal === 'number' && typeof moveValue === 'number' && moveValue < moveGoal) {
    ringIssues.push(`Move ${formatRingProgress(moveValue, moveGoal, 'kcal')}`);
  }
  if (typeof exerciseGoal === 'number' && typeof exerciseValue === 'number' && exerciseValue < exerciseGoal) {
    ringIssues.push(`Exercise ${formatRingProgress(toHours(exerciseValue), toHours(exerciseGoal), 'h', 1)}`);
  }
  if (typeof standGoal === 'number' && typeof standHours === 'number' && standHours < standGoal) {
    ringIssues.push(`Stand ${formatRingProgress(standHours, standGoal, 'h')}`);
  }
  if (isEvening && ringIssues.length > 0) {
    putAlert(alertsByCode, {
      code: 'activity_ring_open',
      severity: ringIssues.length >= 2 ? 'high' : 'watch',
      title: '活动圆环未闭合',
      message: `截至当前仍未闭合的目标：${ringIssues.join('，')}。`,
      recommendation: '建议今晚补一段轻中等强度步行或拉伸，把活动量补齐到接近目标。',
      triggeredAt,
    });
  }

  const hrv = snapshot.heart?.heartRateVariabilityMs ?? snapshot.huawei?.stress?.hrvMs;
  if (typeof hrv === 'number' && hrv < 25) {
    putAlert(alertsByCode, {
      code: 'heart_rate_variability_low',
      severity: hrv < 15 ? 'high' : 'watch',
      title: '心率变异性偏低',
      message: `HRV 约 ${Math.round(hrv)} ms，提示近期恢复储备不足。`,
      recommendation: '建议先降强度、重节律、少熬夜，并用呼吸放松或散步帮助恢复。',
      value: hrv,
      unit: 'ms',
      triggeredAt,
    });
  }

  const vo2Max = snapshot.heart?.vo2MaxMlKgMin;
  if (typeof vo2Max === 'number' && vo2Max < 35) {
    putAlert(alertsByCode, {
      code: 'vo2max_low',
      severity: vo2Max < 30 ? 'high' : 'watch',
      title: '有氧适能偏低',
      message: `VO2 Max 约 ${vo2Max.toFixed(1)} ml/kg/min，低于 35。`,
      recommendation: '建议以低门槛快走、骑行等可持续运动逐步建立基础耐力。',
      value: vo2Max,
      unit: 'ml/kg/min',
      triggeredAt,
    });
  }

  const glucoseMgDl = snapshot.metabolic?.bloodGlucoseMgDl;
  if (typeof glucoseMgDl === 'number') {
    const glucoseMmolL = toMmolL(glucoseMgDl);
    if (glucoseMmolL >= 7.8) {
      putAlert(alertsByCode, {
        code: 'blood_glucose_high',
        severity: glucoseMmolL >= 11.1 ? 'high' : 'watch',
        title: '血糖偏高',
        message: `当前血糖约 ${glucoseMmolL} mmol/L。`,
        recommendation: '建议减少高糖高油夜宵，优先餐后步行并继续复测趋势；若持续偏高请线下评估。',
        value: glucoseMmolL,
        unit: 'mmol/L',
        triggeredAt,
      });
    }
  }

  const bmi =
    snapshot.body?.bmi ??
    (typeof snapshot.body?.bodyMassKg === 'number' && typeof snapshot.profile?.heightCm === 'number'
      ? calculateBmi(snapshot.body.bodyMassKg, snapshot.profile.heightCm)
      : undefined) ??
    (typeof snapshot.profile?.weightKg === 'number' && typeof snapshot.profile?.heightCm === 'number'
      ? calculateBmi(snapshot.profile.weightKg, snapshot.profile.heightCm)
      : undefined) ??
    snapshot.huawei?.body?.bmi;

  if (typeof bmi === 'number' && (bmi < 18.5 || bmi >= 24)) {
    const isUnderweight = bmi < 18.5;
    putAlert(alertsByCode, {
      code: 'bmi_abnormal',
      severity: bmi < 17 || bmi >= 28 ? 'high' : 'watch',
      title: isUnderweight ? 'BMI 偏低提醒' : 'BMI 偏高提醒',
      message: isUnderweight
        ? `按当前身高体重估算 BMI 约 ${bmi.toFixed(1)}，低于理想范围。`
        : `按当前身高体重估算 BMI 约 ${bmi.toFixed(1)}，高于理想范围。`,
      recommendation: isUnderweight
        ? '建议先排查是否长期进食不足、睡眠差或压力过高，优先恢复规律进食与睡眠。'
        : '建议先从作息、进食节律和基础活动量连续调整，不要用短期极端节食来处理。',
      value: bmi,
      unit: 'kg/m²',
      triggeredAt,
    });
  }

  const apneaEventCount = snapshot.sleep?.apnea?.eventCountLast30d;
  const apneaRiskLevel = snapshot.sleep?.apnea?.riskLevel;
  if (
    (typeof apneaEventCount === 'number' && apneaEventCount > 0) ||
    apneaRiskLevel === 'watch' ||
    apneaRiskLevel === 'high'
  ) {
    putAlert(alertsByCode, {
      code: 'sleep_apnea_detected',
      severity:
        apneaRiskLevel === 'high' || (typeof apneaEventCount === 'number' && apneaEventCount >= 3)
          ? 'high'
          : 'watch',
      title: '睡眠呼吸暂停提醒',
      message:
        typeof apneaEventCount === 'number'
          ? `近 30 天检测到约 ${Math.round(apneaEventCount)} 次睡眠呼吸暂停事件。`
          : '检测到睡眠呼吸暂停风险信号。',
      recommendation: '建议尽快做睡眠专项评估，避免长期忽视造成白天疲劳和认知下降。',
      value: apneaEventCount,
      unit: 'events/30d',
      triggeredAt,
    });
  }

  return Array.from(alertsByCode.values()).sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
}

export function mergeTrackedHealthSignals(
  existingSignals: UserHealthSignal[],
  alerts: HealthRiskAlert[],
  fallbackDate: Date
): UserHealthSignal[] {
  const merged = new Map<HealthRiskAlertCode, UserHealthSignal>();

  existingSignals.forEach(signal => {
    merged.set(signal.code, { ...signal });
  });

  alerts.forEach(alert => {
    const detectedAt = new Date(alert.triggeredAt);
    const signalDate = Number.isNaN(detectedAt.getTime()) ? fallbackDate : detectedAt;
    const existing = merged.get(alert.code);

    if (!existing) {
      merged.set(alert.code, {
        code: alert.code,
        title: alert.title,
        severity: alert.severity,
        firstDetectedAt: signalDate,
        lastDetectedAt: signalDate,
        occurrenceCount: 1,
        latestValue: alert.value,
        unit: alert.unit,
        latestMessage: alert.message,
        latestRecommendation: alert.recommendation,
      });
      return;
    }

    merged.set(alert.code, {
      ...existing,
      title: alert.title,
      severity: severityRank(alert.severity) >= severityRank(existing.severity) ? alert.severity : existing.severity,
      lastDetectedAt: signalDate,
      occurrenceCount: existing.occurrenceCount + 1,
      latestValue: alert.value,
      unit: alert.unit,
      latestMessage: alert.message,
      latestRecommendation: alert.recommendation,
    });
  });

  return Array.from(merged.values()).sort(
    (a, b) => b.lastDetectedAt.getTime() - a.lastDetectedAt.getTime()
  );
}
