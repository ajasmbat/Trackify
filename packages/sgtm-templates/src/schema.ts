import { z } from "zod";

// Structural schema for the base container template. Follows the shape of a
// Google Tag Manager v2 container export (exportFormatVersion +
// containerVersion.{container,tag,client,trigger,variable}). Deliberately
// permissive on tag/client parameter contents — the render() step substitutes
// placeholders inside those blobs, and downstream Google validation is more
// strict than anything we can usefully enforce here.

const Parameter = z
  .object({
    type: z.string(),
    key: z.string(),
    value: z.string().optional(),
    list: z.array(z.unknown()).optional(),
    map: z.array(z.unknown()).optional(),
  })
  .passthrough();

const Tag = z
  .object({
    tagId: z.string(),
    name: z.string(),
    type: z.string(),
    parameter: z.array(Parameter).optional(),
    firingTriggerId: z.array(z.string()).optional(),
    priority: z.number().int().optional(),
  })
  .passthrough();

const Client = z
  .object({
    clientId: z.string(),
    name: z.string(),
    type: z.string(),
    priority: z.number().int().optional(),
    parameter: z.array(Parameter).optional(),
  })
  .passthrough();

const Trigger = z
  .object({
    triggerId: z.string(),
    name: z.string(),
    type: z.string(),
  })
  .passthrough();

const Variable = z
  .object({
    variableId: z.string(),
    name: z.string(),
    type: z.string(),
    parameter: z.array(Parameter).optional(),
  })
  .passthrough();

const Container = z
  .object({
    publicId: z.string().min(1),
    name: z.string(),
    usageContext: z.array(z.string()),
  })
  .passthrough();

const ContainerVersion = z
  .object({
    name: z.string(),
    container: Container,
    tag: z.array(Tag).min(1),
    client: z.array(Client).min(1),
    trigger: z.array(Trigger).min(1),
    variable: z.array(Variable).optional(),
  })
  .passthrough();

export const ContainerConfig = z
  .object({
    exportFormatVersion: z.literal(2),
    exportTime: z.string(),
    containerVersion: ContainerVersion,
  })
  .passthrough();

export type ContainerConfig = z.infer<typeof ContainerConfig>;
