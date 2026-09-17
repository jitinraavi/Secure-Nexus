import { z } from "zod";

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Enter a valid email address")
  .max(254);

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128)
  .regex(/[a-zA-Z]/, "Password must contain a letter")
  .regex(/[0-9]/, "Password must contain a number");

export const countryCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .length(2, "Select a country")
  .regex(/^[A-Z]{2}$/, "Select a country");

export const phoneSchema = z
  .string()
  .trim()
  .regex(/^[+]?[0-9 ]{7,16}$/, "Enter a valid phone number")
  .max(20)
  .optional()
  .or(z.literal(""));

export const accountTypeSchema = z.enum(["individual", "business"]);

export const usernameSchema = z
  .string()
  .trim()
  .min(3, "Username must be at least 3 characters")
  .max(20, "Username must be at most 20 characters")
  .regex(/^[a-zA-Z0-9_]+$/, "Usernames can only contain letters, numbers and underscores");

export const gstinSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^$|^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/, "Enter a valid GSTIN")
  .max(15);

export const profileSchema = z.object({
  username: usernameSchema.optional(),
  country: countryCodeSchema.optional(),
  phone: phoneSchema.optional(),
  accountType: accountTypeSchema.optional(),
  gstin: gstinSchema.optional(),
});

export const signupSchema = z
  .object({
    email: emailSchema,
    username: usernameSchema.optional(),
    password: passwordSchema,
    confirmPassword: z.string().min(1),
    country: countryCodeSchema.optional(),
    phone: phoneSchema.optional(),
    accountType: accountTypeSchema.optional(),
    gstin: gstinSchema.optional(),
  })
  .refine(
    (v) => v.accountType !== "business" || Boolean(v.gstin && v.gstin.length === 15),
    {
      message: "GSTIN is required for business accounts",
      path: ["gstin"],
    },
  )
  .refine((v) => v.password === v.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required").max(128),
});

export const verifyTwoFactorSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Enter the 6-digit code"),
});

export const verifyEmailSchema = z.object({
  email: emailSchema,
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Enter the 6-digit code"),
});

export const resendOtpSchema = z.object({
  email: emailSchema,
});

export const otpLoginRequestSchema = z.object({
  email: emailSchema,
});

export const otpLoginVerifySchema = z.object({
  email: emailSchema,
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Enter the 6-digit code"),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required").max(128),
    newPassword: passwordSchema,
    confirmPassword: z.string().min(1),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export const createSecretSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(64),
  plaintext: z.string().min(1, "Content cannot be empty").max(100_000),
});