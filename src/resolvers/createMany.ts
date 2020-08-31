import type { ObjectTypeComposer, Resolver } from 'graphql-compose';
import type { Model, Document } from 'mongoose';
import { recordHelperArgs } from './helpers';
import type { GenResolverOpts } from './index';
import { addErrorCatcherField } from './helpers/addErrorCatcherField';
import { GraphQLError } from 'graphql';

export default function createMany<TSource = Document, TContext = any>(
  model: Model<any>,
  tc: ObjectTypeComposer<TSource, TContext>,
  opts?: GenResolverOpts
): Resolver<TSource, TContext, any> {
  if (!model || !model.modelName || !model.schema) {
    throw new Error('First arg for Resolver createMany() should be instance of Mongoose Model.');
  }

  if (!tc || tc.constructor.name !== 'ObjectTypeComposer') {
    throw new Error(
      'Second arg for Resolver createMany() should be instance of ObjectTypeComposer.'
    );
  }

  const tree = model.schema.obj;
  const requiredFields = [];
  for (const field in tree) {
    if (tree.hasOwnProperty(field)) {
      const fieldOptions = tree[field];
      if (fieldOptions.required && typeof fieldOptions.required !== 'function') {
        requiredFields.push(field);
      }
    }
  }

  const outputTypeName = `CreateMany${tc.getTypeName()}Payload`;
  const outputType = tc.schemaComposer.getOrCreateOTC(outputTypeName, (t) => {
    t.addFields({
      recordIds: {
        type: '[MongoID!]!',
        description: 'Created document ID',
      },
      records: {
        type: tc.getTypeNonNull().getTypePlural().getTypeNonNull(),
        description: 'Created documents',
      },
      createCount: {
        type: 'Int!',
        description: 'Count of all documents created',
      },
    });
  });

  const resolver = tc.schemaComposer.createResolver({
    name: 'createMany',
    kind: 'mutation',
    description: 'Creates Many documents with mongoose defaults, setters, hooks and validation',
    type: outputType,
    args: {
      records: {
        type: (recordHelperArgs(tc, {
          prefix: 'CreateMany',
          suffix: 'Input',
          removeFields: ['id', '_id'],
          isRequired: true,
          requiredFields,
          ...(opts && opts.records),
        }) as any).record.type.List.NonNull,
      },
    },
    resolve: async (resolveParams) => {
      const recordData = resolveParams?.args?.records;

      if (!Array.isArray(recordData) || recordData.length === 0) {
        throw new Error(
          `${tc.getTypeName()}.createMany resolver requires args.records to be an Array and must contain at least one record`
        );
      }

      for (const record of recordData) {
        if (!(typeof record === 'object') || Object.keys(record).length === 0) {
          throw new Error(
            `${tc.getTypeName()}.createMany resolver requires args.records to contain non-empty records, with at least one value`
          );
        }
      }

      const validationErrors = [];
      const docs = [];
      // concurrently create docs
      for (const record of recordData) {
        // eslint-disable-next-line new-cap
        let doc = new model(record);
        if (resolveParams.beforeRecordMutate) {
          doc = await resolveParams.beforeRecordMutate(doc, resolveParams);
        }

        // same as createOne, this could be a function ex: `mapToValidationError`
        const errors: {
          path: string;
          message: string;
          value: any;
        }[] = [];
        const validationError: any = await new Promise((resolve) => {
          doc.validate(resolve);
        });
        if (validationError) {
          Object.keys(validationError.errors).forEach((key) => {
            const { message, value } = validationError.errors[key];
            errors.push({
              path: key,
              message,
              value,
            });
          });
          validationErrors.push({
            message: validationError.message,
            errors: errors,
          });
        } else {
          validationErrors.push(null); // error order
        }
        docs.push(doc);
      }

      const hasValidationError = !validationErrors.every((error) => error === null);
      if (!hasValidationError) {
        await model.create(docs);
      }

      if (hasValidationError) {
        if (!resolveParams?.projection?.error) {
          // if client does not request `errors` field we throw Exception on to level
          throw new GraphQLError(
            'Cannot createMany some documents contain errors',
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            {
              validationErrors: validationErrors,
            }
          );
        }
        return {
          records: null,
          recordIds: null,
          error: validationErrors,
          createCount: docs.length,
        };
      } else {
        return {
          records: docs,
          recordIds: docs.map((doc) => doc._id),
          createCount: docs.length,
        };
      }
    },
  });

  addErrorCatcherField(resolver);

  return resolver;
}
