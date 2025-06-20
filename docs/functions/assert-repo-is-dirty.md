[**Documentation**](../README.md)

---

[Documentation](../README.md) / functions/assert-repo-is-dirty

# functions/assert-repo-is-dirty

## Functions

### assertRepoIsDirty()

> **assertRepoIsDirty**(): `Promise`\<`void`\>

Defined in: [src/functions/assert-repo-is-dirty.mts:17](https://github.com/noshiro-pf/ts-repo-utils/blob/main/src/functions/assert-repo-is-dirty.mts#L17)

Checks if the repository is dirty and exits with code 1 if it is.
Shows git status and diff output before exiting.

#### Returns

`Promise`\<`void`\>

---

### repoIsDirty()

> **repoIsDirty**(): `Promise`\<`boolean`\>

Defined in: [src/functions/assert-repo-is-dirty.mts:8](https://github.com/noshiro-pf/ts-repo-utils/blob/main/src/functions/assert-repo-is-dirty.mts#L8)

Checks if the repository has uncommitted changes.

#### Returns

`Promise`\<`boolean`\>

True if the repo is dirty, false otherwise.

#### Throws

Error if git command fails.
