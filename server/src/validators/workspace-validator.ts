import { checkSchema } from "express-validator";

export default checkSchema({
    name: {
        trim: true,
        errorMessage: "Workspace name is required",
        notEmpty: true,
        isLength: {
            options: { min: 1, max: 120 },
            errorMessage: "Workspace name must be 1-120 chars",
        },
    },
    timezone: {
        optional: { options: { nullable: true } },
        trim: true,
        isLength: {
            options: { max: 64 },
        },
    },
});
