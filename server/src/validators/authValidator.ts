import { checkSchema } from "express-validator";

export const registerValidator = checkSchema({
    email: {
        in: ["body"],
        isEmail: { errorMessage: "Valid email is required" },
        normalizeEmail: true,
    },
    password: {
        in: ["body"],
        isString: true,
        isLength: { options: { min: 8 }, errorMessage: "Password must be at least 8 characters" },
    },
    first_name: {
        in: ["body"],
        isString: true,
        trim: true,
        notEmpty: { errorMessage: "First name is required" },
        isLength: { options: { max: 100 } },
    },
    last_name: {
        in: ["body"],
        optional: { options: { nullable: true } },
        isString: true,
        trim: true,
        isLength: { options: { max: 100 } },
    },
});

export const loginValidator = checkSchema({
    email: {
        in: ["body"],
        isEmail: { errorMessage: "Valid email is required" },
        normalizeEmail: true,
    },
    password: {
        in: ["body"],
        isString: true,
        notEmpty: { errorMessage: "Password is required" },
    },
});
