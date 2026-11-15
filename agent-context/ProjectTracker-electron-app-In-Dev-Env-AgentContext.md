- Add each feature to the feature map. 
- Verify that each feature for each ticket indeed exists in our application. If a ticket does not exist in our application then do not move give it a fix version and leave it in this swim lane (In Dev Env). 
- Run `mise run release:patch` or `mise run release:minor`, to bump the version number.  (Note, `mise run release:major` will be run manually).
- Push tickets to the 'In Production' swimlane.


