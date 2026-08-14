import { generateFbclid, generateGclid } from "./fbclid";

export interface ClickParams {
  fbclid: string;
  gclid: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
}

export function buildClickParams(campaign = "trackify_launch"): ClickParams {
  return {
    fbclid: generateFbclid(),
    gclid: generateGclid(),
    utm_source: "facebook",
    utm_medium: "paid_social",
    utm_campaign: campaign,
  };
}

export function clickTargetUrl(
  storefrontOrigin: string,
  campaign?: string,
): string {
  const params = buildClickParams(campaign);
  const url = new URL("/", storefrontOrigin);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}
